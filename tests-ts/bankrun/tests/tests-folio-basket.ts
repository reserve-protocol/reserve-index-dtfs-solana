import { BN, Program, Provider } from "@coral-xyz/anchor";
import { AccountMeta, Keypair, PublicKey } from "@solana/web3.js";

import {
  airdrop,
  assertError,
  BanksTransactionResultWithMeta,
  buildExpectedArray,
  getConnectors,
  travelFutureSlot,
} from "../bankrun-program-helper";

import {
  getFolioBasketPDA,
  getFolioPDA,
  getUserPendingBasketPDA,
} from "../../../utils/pda-helper";
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
import {
  ACCOUNT_SIZE,
  AccountType,
  ExtensionType,
  getMintLen,
  getTypeLen,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { TestHelper } from "../../../utils/test-helper";
import { LiteSVM } from "litesvm";

/**
 * Tests for folio basket functionality, including:
 * - Adding tokens to baskets
 * - Removing tokens from baskets
 * - Basket size limits
 * - Token validation
 * - Initial share minting
 */

describe("Bankrun - Folio basket", () => {
  let context: LiteSVM;
  let provider: Provider;
  let banksClient: LiteSVM;

  let programFolio: Program<Folio>;

  let keys: any;

  let payerKeypair: Keypair;
  let adminKeypair: Keypair;

  let folioOwnerKeypair: Keypair;

  let folioTokenMint: Keypair;

  let folioPDA: PublicKey;

  const MINTS = [Keypair.generate(), Keypair.generate(), Keypair.generate()];
  const MINTS_2022 = [Keypair.generate()];
  const notIncludedInFolioButInitalizedMint = Keypair.generate();

  const DEFAULT_PARAMS: {
    initialShares: BN;
    withAmountsInUserPendingBasketATA: boolean;
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
    addMintExtension: null;
  } = {
    initialShares: new BN(0),
    tokens: [],
    alreadyIncludedTokens: [],
    removedMint: MINTS[0].publicKey,
    remainingAccounts: () => [],
    folioTokenMintSupply: undefined,
    withAmountsInUserPendingBasketATA: false,

    // Expected changes
    expectedInitialBalanceSharesChange: new BN(0),
    expectedTokenBalanceChanges: Array(MINTS.length).fill(new BN(0)),
    folioStatus: FolioStatus.Initialized,

    addMintExtension: null,
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
        buildInvalidRemainingAccounts(
          [
            { mint: Keypair.generate().publicKey, amount: new BN(1000000000) },
            { mint: Keypair.generate().publicKey, amount: new BN(1000000000) },
          ],
          true
        ),
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
      desc: "(basket is created successfully, With amounts in user pending basket ATA)",
      initialShares: new BN(0),
      expectedError: null,
      tokens: [
        { mint: MINTS[0].publicKey, amount: new BN(1_000_000_000) },
        { mint: MINTS[1].publicKey, amount: new BN(1_000_000_000) },
      ],
      withAmountsInUserPendingBasketATA: true,
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

    ...[ExtensionType.TransferFeeConfig, ExtensionType.NonTransferable].map(
      (extension) => {
        return {
          desc: `Should fail if ${ExtensionType[extension]} is present on mint`,
          expectedError: "UnsupportedSPLToken",
          initialShares: null,
          tokens: [
            { mint: MINTS_2022[0].publicKey, amount: new BN(1_000_000_000) },
          ],
          addMintExtension: async (ctx: LiteSVM, mint: PublicKey) => {
            const accountLen = getMintLen([extension]);
            const existingAccount = await ctx.getAccount(mint);
            const existingData = Buffer.from(existingAccount.data);
            const lengthRequired = accountLen - existingData.length;
            const additionalData = Buffer.alloc(lengthRequired);
            const startForExtensions = ACCOUNT_SIZE - existingData.length;
            additionalData.writeUInt8(AccountType.Mint, startForExtensions);
            let offset = startForExtensions + 1;
            additionalData.writeUInt16LE(extension, offset);
            offset += 2;
            additionalData.writeUInt16LE(getTypeLen(extension), offset);
            offset += 2;

            const finalData = Buffer.concat([existingData, additionalData]);
            ctx.setAccount(mint, {
              ...existingAccount,
              data: finalData,
            });
          },
        };
      }
    ),
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
    }[],
    includeTokenProgramId: boolean = false
  ) {
    for (const token of tokens) {
      initToken(context, adminKeypair.publicKey, token.mint, DEFAULT_DECIMALS);
    }

    return buildRemainingAccounts(
      context,
      tokens,
      folioOwnerKeypair.publicKey,
      adminKeypair.publicKey, // Invalid recipient token account
      true,
      includeTokenProgramId
    );
  }

  async function initBaseCase(
    folioStatus?: FolioStatus,
    folioTokenMintSupply?: BN,
    withAmountsInUserPendingBasketATA?: boolean
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

      mintToken(
        context,
        mint.publicKey,
        1_000,
        withAmountsInUserPendingBasketATA
          ? getUserPendingBasketPDA(folioPDA, folioOwnerKeypair.publicKey)
          : folioOwnerKeypair.publicKey
      );
    }

    for (const mint of MINTS_2022) {
      initToken(
        context,
        adminKeypair.publicKey,
        mint,
        DEFAULT_DECIMALS,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      mintToken(
        context,
        mint.publicKey,
        1_000,
        // Mint to only the user pending basket ATA if the flag is set
        withAmountsInUserPendingBasketATA
          ? getUserPendingBasketPDA(folioPDA, folioOwnerKeypair.publicKey)
          : folioOwnerKeypair.publicKey,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
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

  beforeEach(async () => {
    ({ keys, programFolio, provider, context } = await getConnectors());

    banksClient = context;

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
            withAmountsInUserPendingBasketATA,
            folioStatus,
            addMintExtension,
          } = {
            ...DEFAULT_PARAMS,
            ...restOfParams,
          };

          let beforeUserBalances: { owner: PublicKey; balances: bigint[] }[] =
            [];
          let currentTime: BN;

          beforeEach(async () => {
            await initBaseCase(
              folioStatus,
              undefined,
              withAmountsInUserPendingBasketATA
            );

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
              withAmountsInUserPendingBasketATA
                ? [
                    getUserPendingBasketPDA(
                      folioPDA,
                      folioOwnerKeypair.publicKey
                    ),
                  ]
                : [folioOwnerKeypair.publicKey]
            );

            if (addMintExtension) {
              await addMintExtension(context, tokens[0].mint);
            }
            const currentTimeOnSolana = (await context.getClock())
              .unixTimestamp;
            currentTime = new BN(currentTimeOnSolana.toString());

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
              withAmountsInUserPendingBasketATA,
              await remainingAccounts(),
              tokens.length > 0 &&
                tokens[0].mint.equals(MINTS_2022[0].publicKey)
                ? TOKEN_2022_PROGRAM_ID
                : TOKEN_PROGRAM_ID
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
                TestHelper.assertTime(
                  folio.initializedAt,
                  new BN(currentTime.toString())
                );
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
                withAmountsInUserPendingBasketATA
                  ? [
                      getUserPendingBasketPDA(
                        folioPDA,
                        folioOwnerKeypair.publicKey
                      ),
                    ]
                  : [folioOwnerKeypair.publicKey],
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

          beforeEach(async () => {
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
