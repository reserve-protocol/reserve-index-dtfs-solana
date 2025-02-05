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
} from "../bankrun-account-helper";
import { Folio } from "../../../target/types/folio";
import { Dtfs } from "../../../target/types/dtfs";
import {
  assertInvalidFolioStatusTestCase,
  assertNotOwnerTestCase,
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

describe("Bankrun - Folio basket", () => {
  let context: ProgramTestContext;
  let provider: BankrunProvider;
  let banksClient: BanksClient;

  let programDtf: Program<Dtfs>;
  let programFolio: Program<Folio>;

  let keys: any;

  let payerKeypair: Keypair;
  let adminKeypair: Keypair;

  let folioOwnerKeypair: Keypair;

  let folioTokenMint: Keypair;

  let folioPDA: PublicKey;

  const VALID_DEPLOYMENT_SLOT = new BN(1);
  const PROGRAM_VERSION_VALID = Keypair.generate().publicKey;

  const MINTS = [Keypair.generate(), Keypair.generate(), Keypair.generate()];

  const DEFAULT_PARAMS: {
    initialShares: BN;
    tokens: {
      mint: PublicKey;
      amount: BN;
    }[];
    alreadyIncludedTokens: TokenAmount[];
    removedMints: PublicKey[];
    remainingAccounts: () => AccountMeta[];

    // Expected changes
    expectedInitialBalanceSharesChange: BN;
    expectedTokenBalanceChanges: BN[];
    folioStatus: FolioStatus;
  } = {
    initialShares: new BN(0),
    tokens: [],
    alreadyIncludedTokens: [],
    removedMints: [],
    remainingAccounts: () => [],

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
      desc: "(receiver token account is not ATA of the folio)",
      expectedError: "InvalidReceiverTokenAccount",
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
        new TokenAmount(MINTS[0].publicKey, new BN(0), new BN(0)),
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
        new TokenAmount(MINTS[0].publicKey, new BN(0), new BN(0))
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
        new TokenAmount(MINTS[0].publicKey, new BN(0), new BN(0)),
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
        new TokenAmount(MINTS[0].publicKey, new BN(0), new BN(0)),
      ],
      removedMints: [Keypair.generate().publicKey],
    },
    {
      desc: "(remove token that is in the basket, succeeds)",
      expectedError: null,
      alreadyIncludedTokens: [
        new TokenAmount(MINTS[0].publicKey, new BN(0), new BN(0)),
      ],
      removedMints: [MINTS[0].publicKey],
    },
    {
      desc: "(remove multiple tokens that are in the basket, succeeds)",
      expectedError: null,
      alreadyIncludedTokens: [
        new TokenAmount(MINTS[0].publicKey, new BN(0), new BN(0)),
        new TokenAmount(MINTS[1].publicKey, new BN(0), new BN(0)),
      ],
      removedMints: [MINTS[0].publicKey, MINTS[1].publicKey],
    },
  ];

  function buildInvalidRemainingAccounts(
    tokens: {
      mint: PublicKey;
      amount: BN;
    }[]
  ) {
    return buildRemainingAccounts(
      context,
      tokens,
      folioOwnerKeypair.publicKey,
      adminKeypair.publicKey // Invalid receiver token account
    );
  }

  async function initBaseCase(folioStatus?: FolioStatus) {
    await createAndSetFolio(
      context,
      programFolio,
      folioTokenMint.publicKey,

      folioStatus
    );

    initToken(context, folioPDA, folioTokenMint, DEFAULT_DECIMALS);

    for (const mint of MINTS) {
      initToken(context, adminKeypair.publicKey, mint, DEFAULT_DECIMALS);

      mintToken(context, mint.publicKey, 1_000, folioOwnerKeypair.publicKey);
    }

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
    ({ keys, programDtf, programFolio, provider, context } =
      await getConnectors());

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
        [],

        true
      );

    beforeEach(async () => {
      await initBaseCase();
    });

    describe("should run general tests for add to basket", () => {
      it(`should run ${GeneralTestCases.NotOwner}`, async () => {
        await assertNotOwnerTestCase(
          context,
          programFolio,
          folioOwnerKeypair,
          folioPDA,
          generalIxAddToBasket
        );
      });

      it(`should run ${GeneralTestCases.InvalidFolioStatus}`, async () => {
        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,

          generalIxAddToBasket
        );
      });
    });

    describe("should run general tests for remove from basket", () => {
      beforeEach(async () => {
        await createAndSetFolioBasket(context, programFolio, folioPDA, []);
      });

      it(`should run ${GeneralTestCases.NotOwner}`, async () => {
        await assertNotOwnerTestCase(
          context,
          programFolio,
          folioOwnerKeypair,
          folioPDA,
          generalIxRemoveFromBasket
        );
      });

      it(`should run ${GeneralTestCases.InvalidFolioStatus}`, async () => {
        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,

          generalIxRemoveFromBasket
        );
      });
    });
  });

  /*
  Then the test cases specific to that instruction
  */
  describe("Specific Cases", () => {
    TEST_CASES_ADD_TO_BASKET.forEach(
      ({ desc, expectedError, ...restOfParams }) => {
        describe(`When ${desc}`, () => {
          let txnResult: BanksTransactionResultWithMeta;
          const {
            initialShares,
            tokens,
            removedMints,
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
                removedMints.map(
                  (mint) => new TokenAmount(mint, new BN(0), new BN(0))
                ),
                MAX_FOLIO_TOKEN_AMOUNTS,
                new TokenAmount(PublicKey.default, new BN(0), new BN(0)),
                (tokenAmount) =>
                  !removedMints.some((ta) => ta.equals(tokenAmount.mint))
              );

              for (let i = 0; i < MAX_FOLIO_TOKEN_AMOUNTS; i++) {
                assert.equal(
                  basket.tokenAmounts[i].mint.toString(),
                  expectedTokenAmounts[i].mint.toString()
                );
                assert.equal(
                  basket.tokenAmounts[i].amountForMinting.eq(
                    expectedTokenAmounts[i].amountForMinting
                  ),
                  true
                );
                assert.equal(
                  basket.tokenAmounts[i].amountForRedeeming.eq(
                    expectedTokenAmounts[i].amountForRedeeming
                  ),
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

    TEST_CASES_REMOVE_FROM_BASKET.forEach(
      ({ desc, expectedError, ...restOfParams }) => {
        describe(`When ${desc}`, () => {
          let txnResult: BanksTransactionResultWithMeta;
          const { removedMints, alreadyIncludedTokens } = {
            ...DEFAULT_PARAMS,
            ...restOfParams,
          };

          before(async () => {
            await initBaseCase();

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
              removedMints,

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
                removedMints.map(
                  (mint) => new TokenAmount(mint, new BN(0), new BN(0))
                ),
                MAX_FOLIO_TOKEN_AMOUNTS,
                new TokenAmount(PublicKey.default, new BN(0), new BN(0)),
                (tokenAmount) =>
                  !removedMints.some((ta) => ta.equals(tokenAmount.mint))
              );

              for (let i = 0; i < MAX_FOLIO_TOKEN_AMOUNTS; i++) {
                assert.equal(
                  basket.tokenAmounts[i].mint.toString(),
                  expectedTokenAmounts[i].mint.toString()
                );
                assert.equal(
                  basket.tokenAmounts[i].amountForMinting.eq(
                    expectedTokenAmounts[i].amountForMinting
                  ),
                  true
                );
                assert.equal(
                  basket.tokenAmounts[i].amountForRedeeming.eq(
                    expectedTokenAmounts[i].amountForRedeeming
                  ),
                  true
                );
              }
            });
          }
        });
      }
    );
  });
});
