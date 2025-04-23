import { BN, Program } from "@coral-xyz/anchor";
import { BankrunProvider } from "anchor-bankrun";
import { AccountMeta, Keypair, PublicKey } from "@solana/web3.js";
import {
  BanksClient,
  BanksTransactionResultWithMeta,
  ProgramTestContext,
} from "solana-bankrun";
import {
  airdrop,
  assertError,
  buildExpectedArray,
  getConnectors,
  travelFutureSlot,
} from "../bankrun-program-helper";

import { getFolioBasketPDA, getFolioPDA } from "../../../utils/pda-helper";
import { addToBasket, removeFromBasket } from "../bankrun-ix-helper";
import {
  createAndSetFolio,
  Role,
  createAndSetActor,
  createAndSetFolioBasket,
  closeAccount,
  buildRemainingAccounts,
  TokenAmount,
  FolioStatus,
  getInvalidRemainingAccounts,
  FolioTokenAmount,
} from "../bankrun-account-helper";
import { Folio } from "../../../target/types/folio";
import {
  assertInvalidFolioStatusTestCase,
  assertNotValidRoleTestCase,
  GeneralTestCases,
} from "../bankrun-general-tests-helper";

import {
  DEFAULT_DECIMALS,
  MAX_FOLIO_TOKEN_AMOUNTS,
} from "../../../utils/constants";
import {
  assertExpectedBalancesChanges,
  getTokenBalancesFromMints,
  initToken,
  mintToken,
} from "../bankrun-token-helper";
import { assert } from "chai";

/**
 * Tests for folio basket functionality, including:
 * - Adding tokens to baskets
 * - Removing tokens from baskets
 * - Basket size limits
 * - Token validation
 * - Initial share minting
 */

describe("Bankrun - Folio basket", () => {
  let context: ProgramTestContext;
  let provider: BankrunProvider;
  let banksClient: BanksClient;

  let programFolio: Program<Folio>;

  let keys: any;

  let payerKeypair: Keypair;
  let adminKeypair: Keypair;

  let folioOwnerKeypair: Keypair;

  let folioTokenMint: Keypair;

  let folioPDA: PublicKey;

  const MINTS = [Keypair.generate(), Keypair.generate(), Keypair.generate()];

  const notIncludedInFolioButInitalizedMint = Keypair.generate();

  const DEFAULT_PARAMS: {
    initialShares: BN;
    tokens: {
      mint: PublicKey;
      amount: BN;
    }[];
    alreadyIncludedTokens: FolioTokenAmount[];
    removedMint: PublicKey;
    remainingAccounts: () => AccountMeta[];

    // Expected changes
    expectedInitialBalanceSharesChange: BN;
    expectedTokenBalanceChanges: BN[];
    folioStatus: FolioStatus;
    folioTokenMintSupply: BN | undefined;
  } = {
    initialShares: new BN(0),
    tokens: [],
    alreadyIncludedTokens: [],
    removedMint: MINTS[0].publicKey,
    remainingAccounts: () => [],
    folioTokenMintSupply: undefined,

    // Expected changes
    expectedInitialBalanceSharesChange: new BN(0),
    expectedTokenBalanceChanges: Array(MINTS.length).fill(new BN(0)),
    folioStatus: FolioStatus.Initialized,
  };

  const TEST_CASES_ADD_TO_BASKET = [
    {
      desc: "(remaining accounts is not divisible by 3)",
      expectedError: "InvalidNumberOfRemainingAccounts",
      remainingAccounts: () => getInvalidRemainingAccounts(2),
    },
    {
      desc: "(remaining accounts / 3 != length of amounts)",
      expectedError: "InvalidNumberOfRemainingAccounts",
      remainingAccounts: () => getInvalidRemainingAccounts(3),
      tokens: [
        { mint: Keypair.generate().publicKey, amount: new BN(1000000000) },
        { mint: Keypair.generate().publicKey, amount: new BN(1000000000) },
      ],
    },
    {
      desc: "(recipient token account is not ATA of the folio)",
      expectedError: "InvalidRecipientTokenAccount",
      remainingAccounts: () =>
        buildInvalidRemainingAccounts([
          { mint: Keypair.generate().publicKey, amount: new BN(1000000000) },
          { mint: Keypair.generate().publicKey, amount: new BN(1000000000) },
        ]),
      tokens: [
        { mint: Keypair.generate().publicKey, amount: new BN(1000000000) },
        { mint: Keypair.generate().publicKey, amount: new BN(1000000000) },
      ],
    },
    {
      desc: "(basket being updated, mint already included, succeeds, no changes)",
      expectedError: null,
      alreadyIncludedTokens: [
        new FolioTokenAmount(MINTS[0].publicKey, new BN(0)),
      ],
      tokens: [{ mint: MINTS[0].publicKey, amount: new BN(1_000_000_000) }],
      expectedTokenBalanceChanges: [
        new BN(-1_000_000_000),
        new BN(0),
        new BN(0),
      ],
    },
    {
      desc: "(basket being updated, max number of tokens added, fails)",
      expectedError: "MaxNumberOfTokensReached",
      alreadyIncludedTokens: Array(MAX_FOLIO_TOKEN_AMOUNTS).fill(
        new FolioTokenAmount(MINTS[0].publicKey, new BN(0))
      ),
      tokens: [{ mint: MINTS[1].publicKey, amount: new BN(1_000_000_000) }],
    },
    {
      desc: "(basket is created successfully)",
      initialShares: new BN(0),
      expectedError: null,
      tokens: [
        { mint: MINTS[0].publicKey, amount: new BN(1_000_000_000) },
        { mint: MINTS[1].publicKey, amount: new BN(1_000_000_000) },
      ],
      expectedTokenBalanceChanges: [
        new BN(-1_000_000_000),
        new BN(-1_000_000_000),
        new BN(0),
      ],
    },
    {
      desc: "(basket is updated successfully)",
      expectedError: null,
      alreadyIncludedTokens: [
        new FolioTokenAmount(MINTS[0].publicKey, new BN(100)),
      ],
      tokens: [{ mint: MINTS[1].publicKey, amount: new BN(1_000_000_000) }],
      expectedTokenBalanceChanges: [
        new BN(0),
        new BN(-1_000_000_000),
        new BN(0),
      ],
    },
    {
      desc: "(tries to mint initial shares, and folio is not already initialized, sucess, tokens given)",
      initialShares: new BN(1000000000),
      expectedError: null,
      expectedInitialBalanceSharesChange: new BN(1000000000),
      folioStatus: FolioStatus.Initializing,
      tokens: [{ mint: MINTS[1].publicKey, amount: new BN(1_000_000_000) }],
      expectedTokenBalanceChanges: [
        new BN(0),
        new BN(-1_000_000_000),
        new BN(0),
      ],
    },
    {
      desc: "(tries to mint initial shares, but folio is already initialized, sucess, but no tokens given)",
      initialShares: new BN(1000000000),
      expectedError: null,
      expectedInitialBalanceSharesChange: new BN(0),
    },
  ];

  const TEST_CASES_REMOVE_FROM_BASKET = [
    {
      desc: "(remove token that is not in the basket, fails)",
      expectedError: "InvalidRemovedTokenMints",
      alreadyIncludedTokens: [
        new FolioTokenAmount(MINTS[0].publicKey, new BN(9000)),
      ],
      folioTokenMintSupply: new BN(1),
      removedMint: notIncludedInFolioButInitalizedMint.publicKey,
    },
    {
      desc: "(remove token that is in the basket, succeeds)",
      expectedError: null,
      alreadyIncludedTokens: [
        new FolioTokenAmount(MINTS[0].publicKey, new BN(18000)),
      ],
      removedMint: MINTS[0].publicKey,
    },
  ];

  // Utility for testing remaining accounts related test cases
  function buildInvalidRemainingAccounts(
    tokens: {
      mint: PublicKey;
      amount: BN;
    }[]
  ) {
    for (const token of tokens) {
      initToken(context, adminKeypair.publicKey, token.mint, DEFAULT_DECIMALS);
    }

    return buildRemainingAccounts(
      context,
      tokens,
      folioOwnerKeypair.publicKey,
      adminKeypair.publicKey // Invalid recipient token account
    );
  }

  async function initBaseCase(
    folioStatus?: FolioStatus,
    folioTokenMintSupply?: BN
  ) {
    await createAndSetFolio(
      context,
      programFolio,
      folioTokenMint.publicKey,

      folioStatus
    );

    initToken(
      context,
      folioPDA,
      folioTokenMint,
      DEFAULT_DECIMALS,
      folioTokenMintSupply
    );

    for (const mint of MINTS) {
      initToken(context, adminKeypair.publicKey, mint, DEFAULT_DECIMALS);

      mintToken(context, mint.publicKey, 1_000, folioOwnerKeypair.publicKey);
    }

    initToken(
      context,
      adminKeypair.publicKey,
      notIncludedInFolioButInitalizedMint.publicKey,
      DEFAULT_DECIMALS
    );

    await createAndSetActor(
      context,
      programFolio,
      folioOwnerKeypair,
      folioPDA,
      Role.Owner
    );

    // Reinit account for folio basket
    await closeAccount(context, getFolioBasketPDA(folioPDA));
  }

  before(async () => {
    ({ keys, programFolio, provider, context } = await getConnectors());

    banksClient = context.banksClient;

    payerKeypair = provider.wallet.payer;

    adminKeypair = Keypair.fromSecretKey(Uint8Array.from(keys.admin));

    folioOwnerKeypair = Keypair.generate();
    folioTokenMint = Keypair.generate();

    await airdrop(context, payerKeypair.publicKey, 1000);
    await airdrop(context, adminKeypair.publicKey, 1000);
    await airdrop(context, folioOwnerKeypair.publicKey, 1000);

    folioPDA = getFolioPDA(folioTokenMint.publicKey);

    await initBaseCase();
  });

  describe("General Tests", () => {
    const generalIxAddToBasket = () =>
      addToBasket<true>(
        context,
        banksClient,
        programFolio,
        folioOwnerKeypair,
        folioPDA,
        [],
        new BN(0),
        folioTokenMint.publicKey,

        true
      );

    const generalIxRemoveFromBasket = () =>
      removeFromBasket<true>(
        banksClient,
        programFolio,
        folioOwnerKeypair,
        folioPDA,
        MINTS[0].publicKey,
        folioTokenMint.publicKey,
        true
      );

    beforeEach(async () => {
      await initBaseCase();
    });

    describe("should run general tests for add to basket", () => {
      it(`should run ${GeneralTestCases.NotRole}`, async () => {
        await assertNotValidRoleTestCase(
          context,
          programFolio,
          folioOwnerKeypair,
          folioPDA,
          generalIxAddToBasket
        );
      });

      it(`should run ${GeneralTestCases.InvalidFolioStatus} for MIGRATING & KILLED`, async () => {
        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,
          generalIxAddToBasket,
          FolioStatus.Migrating
        );

        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,
          generalIxAddToBasket,
          FolioStatus.Killed
        );
      });
    });

    describe("should run general tests for remove from basket", () => {
      beforeEach(async () => {
        await createAndSetFolioBasket(context, programFolio, folioPDA, []);
      });

      it(`should run ${GeneralTestCases.NotRole}`, async () => {
        await assertNotValidRoleTestCase(
          context,
          programFolio,
          folioOwnerKeypair,
          folioPDA,
          generalIxRemoveFromBasket
        );
      });

      it(`should run ${GeneralTestCases.InvalidFolioStatus} for MIGRATING & KILLED`, async () => {
        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,
          generalIxRemoveFromBasket,
          FolioStatus.Migrating
        );

        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,
          generalIxRemoveFromBasket,
          FolioStatus.Killed
        );
      });
    });
  });

  describe("Specific Cases - Add to Basket", () => {
    TEST_CASES_ADD_TO_BASKET.forEach(
      ({ desc, expectedError, ...restOfParams }) => {
        describe(`When ${desc}`, () => {
          let txnResult: BanksTransactionResultWithMeta;
          const {
            initialShares,
            tokens,
            alreadyIncludedTokens,
            remainingAccounts,
            expectedInitialBalanceSharesChange,
            expectedTokenBalanceChanges,
            folioStatus,
          } = {
            ...DEFAULT_PARAMS,
            ...restOfParams,
          };

          let beforeUserBalances: { owner: PublicKey; balances: bigint[] }[] =
            [];

          before(async () => {
            await initBaseCase(folioStatus);

            if (alreadyIncludedTokens.length > 0) {
              await createAndSetFolioBasket(
                context,
                programFolio,
                folioPDA,
                alreadyIncludedTokens
              );
              await travelFutureSlot(context);
            }

            await travelFutureSlot(context);

            beforeUserBalances = await getTokenBalancesFromMints(
              context,
              [
                folioTokenMint.publicKey,
                ...MINTS.map((mint) => mint.publicKey),
              ],
              [folioOwnerKeypair.publicKey]
            );

            txnResult = await addToBasket<true>(
              context,
              banksClient,
              programFolio,
              folioOwnerKeypair,
              folioPDA,
              tokens,
              initialShares,
              folioTokenMint.publicKey,

              true,
              await remainingAccounts()
            );
          });

          if (expectedError) {
            it("should fail with expected error", () => {
              assertError(txnResult, expectedError);
            });
          } else {
            it("should succeed", async () => {
              await travelFutureSlot(context);

              // Folio changes (status only, if initial shares are getting minted)
              if (expectedInitialBalanceSharesChange.gt(new BN(0))) {
                const folio = await programFolio.account.folio.fetch(folioPDA);
                assert.equal(folio.status, FolioStatus.Initialized);
              }

              // Else we validate basket changes
              const basket = await programFolio.account.folioBasket.fetch(
                getFolioBasketPDA(folioPDA)
              );

              const expectedTokenAmounts = buildExpectedArray(
                alreadyIncludedTokens,
                tokens
                  .map(
                    (token) => new TokenAmount(token.mint, new BN(0), new BN(0))
                  )
                  // Filter duplicates
                  .filter(
                    (tokenAmount) =>
                      !alreadyIncludedTokens.some((ta) =>
                        ta.mint.equals(tokenAmount.mint)
                      )
                  ),
                [],
                MAX_FOLIO_TOKEN_AMOUNTS,
                new TokenAmount(PublicKey.default, new BN(0), new BN(0)),
                () => true
              );

              for (let i = 0; i < MAX_FOLIO_TOKEN_AMOUNTS; i++) {
                assert.equal(
                  basket.basket.tokenAmounts[i].mint.toString(),
                  expectedTokenAmounts[i].mint.toString()
                );

                const alreadyIncludedAmount =
                  alreadyIncludedTokens.find((ta) =>
                    ta.mint.equals(expectedTokenAmounts[i].mint)
                  )?.amount ?? new BN(0);

                const newAmountAdded =
                  tokens.find((token) =>
                    token.mint.equals(expectedTokenAmounts[i].mint)
                  )?.amount ?? new BN(0);

                const expectedAmount =
                  alreadyIncludedAmount.add(newAmountAdded);
                assert.equal(
                  basket.basket.tokenAmounts[i].amount.eq(expectedAmount),
                  true
                );
              }

              // And assert transfer of token amounts & initial shares
              await assertExpectedBalancesChanges(
                context,
                beforeUserBalances,
                [
                  folioTokenMint.publicKey,
                  ...MINTS.map((mint) => mint.publicKey),
                ],
                [folioOwnerKeypair.publicKey],
                [
                  expectedInitialBalanceSharesChange,
                  ...expectedTokenBalanceChanges,
                ]
              );
            });
          }
        });
      }
    );
  });

  describe("Specific Cases - Remove from Basket", () => {
    TEST_CASES_REMOVE_FROM_BASKET.forEach(
      ({ desc, expectedError, ...restOfParams }) => {
        describe(`When ${desc}`, () => {
          let txnResult: BanksTransactionResultWithMeta;
          const { removedMint, alreadyIncludedTokens, folioTokenMintSupply } = {
            ...DEFAULT_PARAMS,
            ...restOfParams,
          };

          before(async () => {
            await initBaseCase(undefined, folioTokenMintSupply);

            if (alreadyIncludedTokens.length > 0) {
              await createAndSetFolioBasket(
                context,
                programFolio,
                folioPDA,
                alreadyIncludedTokens
              );
              await travelFutureSlot(context);
            }

            await travelFutureSlot(context);

            txnResult = await removeFromBasket<true>(
              banksClient,
              programFolio,
              folioOwnerKeypair,
              folioPDA,
              folioTokenMint.publicKey,
              removedMint,

              true
            );
          });

          if (expectedError) {
            it("should fail with expected error", () => {
              assertError(txnResult, expectedError);
            });
          } else {
            it("should succeed", async () => {
              await travelFutureSlot(context);

              const basket = await programFolio.account.folioBasket.fetch(
                getFolioBasketPDA(folioPDA)
              );

              const expectedTokenAmounts = buildExpectedArray(
                alreadyIncludedTokens,
                [],
                [new TokenAmount(removedMint, new BN(0), new BN(0))],
                MAX_FOLIO_TOKEN_AMOUNTS,
                new TokenAmount(PublicKey.default, new BN(0), new BN(0)),
                (tokenAmount) => !removedMint.equals(tokenAmount.mint)
              );

              for (let i = 0; i < MAX_FOLIO_TOKEN_AMOUNTS; i++) {
                assert.equal(
                  basket.basket.tokenAmounts[i].mint.toString(),
                  expectedTokenAmounts[i].mint.toString()
                );

                const isRemoved = removedMint.equals(
                  expectedTokenAmounts[i].mint
                );
                if (isRemoved) {
                  assert.equal(
                    basket.basket.tokenAmounts[i].amount.eq(new BN(0)),
                    true
                  );
                } else {
                  const alreadyIncludedAmount =
                    alreadyIncludedTokens.find((ta) =>
                      ta.mint.equals(expectedTokenAmounts[i].mint)
                    )?.amount ?? new BN(0);

                  const expectedAmount = alreadyIncludedAmount;
                  assert.equal(
                    basket.basket.tokenAmounts[i].amount.eq(expectedAmount),
                    true
                  );
                }
              }
            });
          }
        });
      }
    );
  });
});
