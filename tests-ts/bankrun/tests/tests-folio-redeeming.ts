import { BN, Program } from "@coral-xyz/anchor";
import { BankrunProvider } from "anchor-bankrun";
import { AccountMeta, Keypair, PublicKey } from "@solana/web3.js";
import {
  BanksClient,
  BanksTransactionResultWithMeta,
  ProgramTestContext,
} from "solana-bankrun";

import {
  TokenAmount,
  buildRemainingAccounts,
  createAndSetActor,
  createAndSetFolio,
  FolioStatus,
  createAndSetUserPendingBasket,
  createAndSetDaoFeeConfig,
  getInvalidRemainingAccounts,
} from "../bankrun-account-helper";
import {
  assertExpectedBalancesChanges,
  getAtaAddress,
  getTokenBalancesFromMints,
  mintToken,
} from "../bankrun-token-helper";
import { Folio } from "../../../target/types/folio";
import {
  DEFAULT_DECIMALS,
  MAX_FOLIO_TOKEN_AMOUNTS,
  MAX_USER_PENDING_BASKET_TOKEN_AMOUNTS,
  MIN_DAO_MINTING_FEE,
} from "../../../utils/constants";
import { initToken } from "../bankrun-token-helper";
import { createAndSetFolioBasket, Role } from "../bankrun-account-helper";
import {
  airdrop,
  assertError,
  assertPreTransactionError,
  buildExpectedArray,
  getConnectors,
  travelFutureSlot,
} from "../bankrun-program-helper";
import {
  getFolioBasketPDA,
  getFolioPDA,
  getUserPendingBasketPDA,
} from "../../../utils/pda-helper";
import { burnFolioToken, redeemFromPendingBasket } from "../bankrun-ix-helper";
import {
  assertInvalidFolioStatusTestCase,
  GeneralTestCases,
} from "../bankrun-general-tests-helper";
import * as assert from "assert";
import { FolioAdmin } from "../../../target/types/folio_admin";

describe("Bankrun - Folio redeeming", () => {
  let context: ProgramTestContext;
  let provider: BankrunProvider;
  let banksClient: BanksClient;

  let programFolioAdmin: Program<FolioAdmin>;
  let programFolio: Program<Folio>;

  let keys: any;

  let payerKeypair: Keypair;
  let adminKeypair: Keypair;

  let folioOwnerKeypair: Keypair;
  let folioTokenMint: Keypair;
  let folioPDA: PublicKey;

  let userKeypair: Keypair;

  const MINTS = Array(MAX_FOLIO_TOKEN_AMOUNTS)
    .fill(null)
    .map(() => Keypair.generate());

  const DEFAULT_PARAMS: {
    alreadyIncludedTokens: TokenAmount[];
    tokens: {
      mint: PublicKey;
      amount: BN;
      remove: boolean;
    }[];
    folioBasketTokens: TokenAmount[];

    customFolioTokenMint: Keypair | null;
    initialUserShares: BN;
    shares: BN;
    remainingAccounts: () => AccountMeta[];

    // Is Validated before sending the transaction
    isPreTransactionValidated: boolean;

    // Expected changes
    expectedFolioTokenBalanceChange: BN;
    expectedTokenBalanceChanges: BN[];
  } = {
    alreadyIncludedTokens: [],
    tokens: [],
    folioBasketTokens: [],

    customFolioTokenMint: null,
    initialUserShares: new BN(0),
    shares: new BN(0),
    remainingAccounts: () => [],

    // Is Validated before sending the transaction
    isPreTransactionValidated: false,

    // Expected changes
    expectedFolioTokenBalanceChange: new BN(0),
    expectedTokenBalanceChanges: Array(MINTS.length).fill(new BN(0)),
  };

  const TEST_CASES_BURN_FOLIO_TOKEN = [
    {
      desc: "(trying to burn folio token, user providing the wrong folio mint, errors out)",
      expectedError: "InvalidFolioTokenMint",
      customFolioTokenMint: Keypair.generate(),
      folioBasketTokens: [
        new TokenAmount(MINTS[0].publicKey, new BN(0), new BN(0)),
      ],
      tokens: [{ mint: MINTS[0].publicKey, amount: new BN(0) }],
    },
    {
      desc: "(trying to burn folio token, user is passing no remaining accounts, errors out)",
      expectedError: "InvalidNumberOfRemainingAccounts",
      folioBasketTokens: [
        new TokenAmount(MINTS[0].publicKey, new BN(0), new BN(0)),
        new TokenAmount(MINTS[1].publicKey, new BN(0), new BN(0)),
      ],
      alreadyIncludedTokens: [
        new TokenAmount(MINTS[0].publicKey, new BN(0), new BN(0)),
        new TokenAmount(MINTS[1].publicKey, new BN(0), new BN(0)),
      ],
      tokens: [],
      shares: new BN(1),
    },
    {
      desc: "(trying to burn folio token, user is passing the wrong remaining accounts, errors out)",
      expectedError: "InvalidReceiverTokenAccount",
      remainingAccounts: () => [
        {
          pubkey: getAtaAddress(MINTS[2].publicKey, folioPDA),
          isSigner: false,
          isWritable: false,
        },
        {
          pubkey: getAtaAddress(MINTS[1].publicKey, folioPDA),
          isSigner: false,
          isWritable: false,
        },
      ],
      folioBasketTokens: [
        new TokenAmount(MINTS[0].publicKey, new BN(0), new BN(0)),
        new TokenAmount(MINTS[1].publicKey, new BN(0), new BN(0)),
      ],
      alreadyIncludedTokens: [
        new TokenAmount(MINTS[0].publicKey, new BN(0), new BN(0)),
        new TokenAmount(MINTS[1].publicKey, new BN(0), new BN(0)),
      ],
      tokens: [
        { mint: MINTS[0].publicKey, amount: new BN(0) },
        { mint: MINTS[2].publicKey, amount: new BN(0) },
      ],
      shares: new BN(1),
    },
    {
      desc: "(user trying to burn more shares than he is allowed, errors out)",
      expectedError: "InsufficientFunds",
      folioBasketTokens: [
        new TokenAmount(MINTS[0].publicKey, new BN(0), new BN(100_000)),
      ],
      alreadyIncludedTokens: [
        new TokenAmount(MINTS[0].publicKey, new BN(0), new BN(100_000)),
      ],
      tokens: [{ mint: MINTS[0].publicKey, amount: new BN(0) }],
      // User has 0 right now
      shares: new BN(1),
    },
    {
      // Folio balances are 1000 tokens each
      // User has 1 share, supply is 1000
      // User burns 0.001 token
      // Expected balances to be 1 000 000 of each token
      desc: "(user burns part of his folio token balance, succeeds)",
      expectedError: null,
      folioBasketTokens: [
        new TokenAmount(MINTS[0].publicKey, new BN(0), new BN(0)),
        new TokenAmount(MINTS[1].publicKey, new BN(0), new BN(0)),
      ],
      alreadyIncludedTokens: [
        new TokenAmount(MINTS[0].publicKey, new BN(0), new BN(0)),
        new TokenAmount(MINTS[1].publicKey, new BN(0), new BN(0)),
      ],
      tokens: [
        { mint: MINTS[0].publicKey, amount: new BN(0) },
        { mint: MINTS[1].publicKey, amount: new BN(0) },
      ],
      initialUserShares: new BN(1_000_000_000),
      shares: new BN(1_000_000), // 0.001
      expectedFolioTokenBalanceChange: new BN(1_000_000),
      expectedTokenBalanceChanges: [new BN(1_000_000), new BN(1_000_000)],
    },
    // Folio balances are 1000 tokens each
    // User has 1 share, supply is 1000
    // User burns 1 token
    // Expected balances to be 1 000 000 000 of each token (1 token)
    {
      desc: "(users burns max amount of shares he can, succeeds)",
      expectedError: null,
      folioBasketTokens: [
        new TokenAmount(MINTS[0].publicKey, new BN(0), new BN(0)),
        new TokenAmount(MINTS[1].publicKey, new BN(0), new BN(0)),
      ],
      alreadyIncludedTokens: [
        new TokenAmount(MINTS[0].publicKey, new BN(0), new BN(0)),
        new TokenAmount(MINTS[1].publicKey, new BN(0), new BN(0)),
      ],
      tokens: [
        { mint: MINTS[0].publicKey, amount: new BN(0) },
        { mint: MINTS[1].publicKey, amount: new BN(0) },
      ],
      initialUserShares: new BN(1_000_000_000),
      shares: new BN(1_000_000_000),
      expectedFolioTokenBalanceChange: new BN(1_000_000_000),
      expectedTokenBalanceChanges: [
        new BN(1_000_000_000),
        new BN(1_000_000_000),
      ],
    },
  ];

  const TEST_CASES_REDEEM_FROM_PENDING_BASKET = [
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
      desc: "(receiver token account is not ATA of the user)",
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
      desc: "(user redeeming a token, but reqests an amount more than he has in his balance, errors out)",
      expectedError: "InsufficientFunds",
      folioBasketTokens: [
        new TokenAmount(MINTS[0].publicKey, new BN(0), new BN(1_000_000)),
      ],
      alreadyIncludedTokens: [
        new TokenAmount(MINTS[0].publicKey, new BN(0), new BN(1_000_000)),
      ],
      tokens: [
        { mint: MINTS[0].publicKey, amount: new BN(10_000_000_000_000) },
      ],
    },
    {
      desc: "(user redeeming a token that the folio has, but the user doesn't (he redeems when that coin didn't exists i.e.), errors out)",
      expectedError: "InvalidRemovedTokenMints",
      folioBasketTokens: [
        new TokenAmount(MINTS[0].publicKey, new BN(0), new BN(1_000_000)),
      ],
      alreadyIncludedTokens: [
        new TokenAmount(MINTS[1].publicKey, new BN(0), new BN(1_000_000)),
      ],
      tokens: [{ mint: MINTS[0].publicKey, amount: new BN(1_000_000) }],
    },
    {
      desc: "(user tries to redeem more than he has, errors out)",
      expectedError: "InvalidShareAmountProvided",
      folioBasketTokens: [
        new TokenAmount(MINTS[0].publicKey, new BN(0), new BN(1_000_000_000)),
      ],
      alreadyIncludedTokens: [
        new TokenAmount(MINTS[0].publicKey, new BN(0), new BN(1_000_000)),
      ],
      tokens: [{ mint: MINTS[0].publicKey, amount: new BN(10_000_000) }],
    },
    {
      desc: "(user tries to redeem too many tokens at the same time, transaction size issue, errors out)",
      expectedError: "TransactionTooLarge",
      folioBasketTokens: MINTS.map(
        (mint) => new TokenAmount(mint.publicKey, new BN(0), new BN(0))
      ),
      // Tries to redeem all the tokens at the same time
      tokens: MINTS.map((mint) => ({
        mint: mint.publicKey,
        amount: new BN(1_000_000_000),
      })),
      isPreTransactionValidated: true,
    },
    {
      desc: "(user redeeming two tokens, one he had already redeemed part of, other one is new, succeeds)",
      expectedError: null,
      folioBasketTokens: [
        new TokenAmount(MINTS[0].publicKey, new BN(0), new BN(1_000_000)),
        new TokenAmount(MINTS[1].publicKey, new BN(0), new BN(500_000)),
      ],
      alreadyIncludedTokens: [
        new TokenAmount(MINTS[0].publicKey, new BN(0), new BN(1_000_000)),
        new TokenAmount(MINTS[1].publicKey, new BN(0), new BN(500_000)),
      ],
      tokens: [
        { mint: MINTS[0].publicKey, amount: new BN(1_000_000) },
        { mint: MINTS[1].publicKey, amount: new BN(500_000) },
      ],
      expectedTokenBalanceChanges: [new BN(1_000_000), new BN(500_000)],
    },
    {
      desc: "(user redeems max amount tokens for transaction size, succeeds)",
      expectedError: "",
      folioBasketTokens: MINTS.slice(0, 5).map(
        (mint) => new TokenAmount(mint.publicKey, new BN(0), new BN(1_000_000))
      ),
      alreadyIncludedTokens: MINTS.slice(0, 5).map(
        (mint) => new TokenAmount(mint.publicKey, new BN(0), new BN(1_000_000))
      ),
      tokens: MINTS.slice(0, 5).map((mint) => ({
        mint: mint.publicKey,
        amount: new BN(1_000_000),
      })),
      expectedTokenBalanceChanges: Array(5).fill(new BN(1_000_000)),
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

  async function initBaseCase(
    folioBasketTokens: TokenAmount[] = [],
    customFolioTokenMint: Keypair | null = null,
    customFolioTokenSupply: BN = new BN(0),
    customInitialUserShares: BN = new BN(0)
  ) {
    await createAndSetDaoFeeConfig(
      context,
      programFolioAdmin,
      adminKeypair.publicKey,
      MIN_DAO_MINTING_FEE
    );

    await createAndSetFolio(context, programFolio, folioTokenMint.publicKey);

    initToken(
      context,
      folioPDA,
      folioTokenMint,
      DEFAULT_DECIMALS,
      customFolioTokenSupply
    );

    if (customFolioTokenMint) {
      initToken(context, folioPDA, customFolioTokenMint, DEFAULT_DECIMALS);
    }

    // Give initial balance of tokens to the folio for each of the mint it has
    for (const mint of folioBasketTokens) {
      mintToken(context, mint.mint, 1_000, folioPDA);
    }

    if (customInitialUserShares) {
      mintToken(
        context,
        folioTokenMint.publicKey,
        customInitialUserShares.toNumber(),
        userKeypair.publicKey
      );
    }

    for (const mint of MINTS) {
      initToken(context, adminKeypair.publicKey, mint, DEFAULT_DECIMALS);
    }

    await createAndSetActor(
      context,
      programFolio,
      folioOwnerKeypair,
      folioPDA,
      Role.Owner
    );

    await createAndSetFolioBasket(
      context,
      programFolio,
      folioPDA,
      folioBasketTokens
    );

    // Reinit account for pending user basket
    await createAndSetUserPendingBasket(
      context,
      programFolio,
      folioPDA,
      userKeypair.publicKey,
      []
    );
  }

  before(async () => {
    ({ keys, programFolioAdmin, programFolio, provider, context } =
      await getConnectors());

    banksClient = context.banksClient;

    payerKeypair = provider.wallet.payer;

    adminKeypair = Keypair.fromSecretKey(Uint8Array.from(keys.admin));

    folioOwnerKeypair = Keypair.generate();
    folioTokenMint = Keypair.generate();
    userKeypair = Keypair.generate();

    await airdrop(context, payerKeypair.publicKey, 1000);
    await airdrop(context, adminKeypair.publicKey, 1000);
    await airdrop(context, folioOwnerKeypair.publicKey, 1000);
    await airdrop(context, userKeypair.publicKey, 1000);

    folioPDA = getFolioPDA(folioTokenMint.publicKey);

    await initBaseCase();
  });

  describe("General Tests", () => {
    const generalIxBurnFolioToken = () =>
      burnFolioToken<true>(
        context,
        banksClient,
        programFolio,
        userKeypair,
        folioPDA,
        folioTokenMint.publicKey,
        new BN(0),
        [],

        true
      );

    const generalIxRedeemFromPendingBasket = () =>
      redeemFromPendingBasket<true>(
        context,
        banksClient,
        programFolio,
        userKeypair,
        folioPDA,
        [],

        true
      );

    beforeEach(async () => {
      await initBaseCase();
    });

    describe("should run general tests for burn folio token", () => {
      it(`should run ${GeneralTestCases.InvalidFolioStatus} for INITIALIZING`, async () => {
        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,

          generalIxBurnFolioToken,
          FolioStatus.Initializing
        );
      });
    });

    describe("should run general tests for redeem from pending basket", () => {
      it(`should run ${GeneralTestCases.InvalidFolioStatus} for INITIALIZING`, async () => {
        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,

          generalIxRedeemFromPendingBasket,
          FolioStatus.Initializing
        );
      });
    });
  });

  describe("Specific Cases - Burn folio token", () => {
    TEST_CASES_BURN_FOLIO_TOKEN.forEach(
      ({ desc, expectedError, ...restOfParams }) => {
        describe(`When ${desc}`, () => {
          let txnResult: BanksTransactionResultWithMeta;
          const {
            remainingAccounts,
            tokens,
            folioBasketTokens,
            alreadyIncludedTokens,
            isPreTransactionValidated,
            expectedFolioTokenBalanceChange,
            expectedTokenBalanceChanges,
            initialUserShares,
            shares,
            customFolioTokenMint,
          } = {
            ...DEFAULT_PARAMS,
            ...restOfParams,
          };

          let beforeUserBalances: { owner: PublicKey; balances: bigint[] }[] =
            [];

          let basketBefore: TokenAmount[] = [];
          let userPendingBasketBefore: TokenAmount[] = [];

          let preTxnError: any;

          before(async () => {
            preTxnError = null;

            await initBaseCase(
              folioBasketTokens,
              customFolioTokenMint,
              new BN(1000_000_000_000),
              initialUserShares
            );

            await createAndSetUserPendingBasket(
              context,
              programFolio,
              folioPDA,
              userKeypair.publicKey,
              alreadyIncludedTokens
            );

            await travelFutureSlot(context);

            const tokenMintToUse = customFolioTokenMint || folioTokenMint;

            beforeUserBalances = await getTokenBalancesFromMints(
              context,
              [folioTokenMint.publicKey],
              [userKeypair.publicKey]
            );

            basketBefore = (
              await programFolio.account.folioBasket.fetch(
                getFolioBasketPDA(folioPDA)
              )
            ).tokenAmounts;

            userPendingBasketBefore = (
              await programFolio.account.userPendingBasket.fetch(
                getUserPendingBasketPDA(folioPDA, userKeypair.publicKey)
              )
            ).tokenAmounts;

            try {
              txnResult = await burnFolioToken<true>(
                context,
                banksClient,
                programFolio,
                userKeypair,
                folioPDA,
                tokenMintToUse.publicKey,
                shares,
                tokens,

                true,
                remainingAccounts()
              );
            } catch (e) {
              // Transaction limit is caught before sending the transaction
              preTxnError = e;
            }
          });

          if (isPreTransactionValidated) {
            it("should fail pre transaction validation", () => {
              assertPreTransactionError(preTxnError, expectedError);
            });
            return;
          }

          if (expectedError) {
            it("should fail with expected error", () => {
              assertError(txnResult, expectedError);
            });
          } else {
            it("should succeed", async () => {
              await travelFutureSlot(context);

              // Folio basket has changed amounts and token accounts have change balances
              const basket = await programFolio.account.folioBasket.fetch(
                getFolioBasketPDA(folioPDA)
              );

              const expectedTokenAmountsForFolioBasket = buildExpectedArray(
                folioBasketTokens,
                tokens
                  .map(
                    (token) => new TokenAmount(token.mint, new BN(0), new BN(0))
                  )
                  // Filter duplicates
                  .filter(
                    (tokenAmount) =>
                      !folioBasketTokens.some((ta) =>
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
                  basket.tokenAmounts[i].mint.toString(),
                  expectedTokenAmountsForFolioBasket[i].mint.toString()
                );
                assert.equal(
                  basket.tokenAmounts[i].amountForMinting.eq(
                    expectedTokenAmountsForFolioBasket[i].amountForMinting
                  ),
                  true
                );
                // Amount for redeeming will be asserted below
              }

              // User pending basket has changed amounts and token accounts have change balances
              const userPendingBasket =
                await programFolio.account.userPendingBasket.fetch(
                  getUserPendingBasketPDA(folioPDA, userKeypair.publicKey)
                );

              const expectedTokenAmountsForUserPendingBasket =
                buildExpectedArray(
                  alreadyIncludedTokens,
                  tokens
                    .map(
                      (token) =>
                        new TokenAmount(token.mint, new BN(0), new BN(0))
                    )
                    // Filter duplicates
                    .filter(
                      (tokenAmount) =>
                        !alreadyIncludedTokens.some((ta) =>
                          ta.mint.equals(tokenAmount.mint)
                        )
                    ),
                  [],
                  MAX_USER_PENDING_BASKET_TOKEN_AMOUNTS,
                  new TokenAmount(PublicKey.default, new BN(0), new BN(0)),
                  () => true
                );

              for (let i = 0; i < MAX_USER_PENDING_BASKET_TOKEN_AMOUNTS; i++) {
                assert.equal(
                  userPendingBasket.tokenAmounts[i].mint.toString(),
                  expectedTokenAmountsForUserPendingBasket[i].mint.toString()
                );
                assert.equal(
                  userPendingBasket.tokenAmounts[i].amountForMinting.eq(
                    expectedTokenAmountsForUserPendingBasket[i].amountForMinting
                  ),
                  true
                );
                // Amount for redeeming will be asserted below
              }

              // Assertion for redeeming amouunt
              for (let i = 0; i < folioBasketTokens.length; i++) {
                // Both user and folio should have the same amount added from redeeming
                assert.equal(
                  basket.tokenAmounts[i].amountForRedeeming.eq(
                    basketBefore[i].amountForRedeeming.add(
                      expectedTokenBalanceChanges[i]
                    )
                  ),
                  true
                );
                assert.equal(
                  userPendingBasket.tokenAmounts[i].amountForRedeeming.eq(
                    userPendingBasketBefore[i].amountForRedeeming.add(
                      expectedTokenBalanceChanges[i]
                    )
                  ),
                  true
                );
              }

              // And assert transfer of token amounts
              await assertExpectedBalancesChanges(
                context,
                beforeUserBalances,
                [folioTokenMint.publicKey],
                [userKeypair.publicKey],
                [
                  // Amounts for user (burning so negative)
                  expectedFolioTokenBalanceChange.neg(),
                ]
              );
            });
          }
        });
      }
    );
  });

  describe("Specific Cases - Redeem from pending basket", () => {
    TEST_CASES_REDEEM_FROM_PENDING_BASKET.forEach(
      ({ desc, expectedError, ...restOfParams }) => {
        describe(`When ${desc}`, () => {
          let txnResult: BanksTransactionResultWithMeta;
          const {
            remainingAccounts,
            tokens,
            folioBasketTokens,
            alreadyIncludedTokens,
            isPreTransactionValidated,
            expectedTokenBalanceChanges,
          } = {
            ...DEFAULT_PARAMS,
            ...restOfParams,
          };

          let beforeUserBalances: { owner: PublicKey; balances: bigint[] }[] =
            [];

          let basketBefore: TokenAmount[] = [];
          let userPendingBasketBefore: TokenAmount[] = [];

          let preTxnError: any;

          before(async () => {
            preTxnError = null;

            await initBaseCase(folioBasketTokens);

            await createAndSetUserPendingBasket(
              context,
              programFolio,
              folioPDA,
              userKeypair.publicKey,
              alreadyIncludedTokens
            );

            await travelFutureSlot(context);

            beforeUserBalances = await getTokenBalancesFromMints(
              context,
              [...folioBasketTokens.map((ta) => ta.mint)],
              [userKeypair.publicKey, folioPDA]
            );

            basketBefore = (
              await programFolio.account.folioBasket.fetch(
                getFolioBasketPDA(folioPDA)
              )
            ).tokenAmounts;

            userPendingBasketBefore = (
              await programFolio.account.userPendingBasket.fetch(
                getUserPendingBasketPDA(folioPDA, userKeypair.publicKey)
              )
            ).tokenAmounts;

            try {
              txnResult = await redeemFromPendingBasket<true>(
                context,
                banksClient,
                programFolio,
                userKeypair,
                folioPDA,
                tokens,

                true,
                await remainingAccounts()
              );
            } catch (e) {
              // Transaction limit is caught before sending the transaction
              preTxnError = e;
            }
          });

          if (isPreTransactionValidated) {
            it("should fail pre transaction validation", () => {
              assertPreTransactionError(preTxnError, expectedError);
            });
            return;
          }

          if (expectedError) {
            it("should fail with expected error", () => {
              assertError(txnResult, expectedError);
            });
          } else {
            it("should succeed", async () => {
              await travelFutureSlot(context);

              // Folio basket has changed amounts and token accounts have change balances
              const basket = await programFolio.account.folioBasket.fetch(
                getFolioBasketPDA(folioPDA)
              );

              const expectedTokenAmountsForFolioBasket = buildExpectedArray(
                folioBasketTokens,
                [],
                [],
                MAX_FOLIO_TOKEN_AMOUNTS,
                new TokenAmount(PublicKey.default, new BN(0), new BN(0)),
                () => true
              );

              for (let i = 0; i < MAX_FOLIO_TOKEN_AMOUNTS; i++) {
                assert.equal(
                  basket.tokenAmounts[i].mint.toString(),
                  expectedTokenAmountsForFolioBasket[i].mint.toString()
                );
                assert.equal(
                  basket.tokenAmounts[i].amountForMinting.eq(
                    expectedTokenAmountsForFolioBasket[i].amountForMinting
                  ),
                  true
                );
                // Amount for redeeming will be asserted below
              }

              // User pending basket has changed amounts and token accounts have change balances
              const userPendingBasket =
                await programFolio.account.userPendingBasket.fetch(
                  getUserPendingBasketPDA(folioPDA, userKeypair.publicKey)
                );

              const expectedTokenAmountsForUserPendingBasket =
                buildExpectedArray(
                  alreadyIncludedTokens,
                  tokens
                    .map(
                      (token) =>
                        new TokenAmount(token.mint, new BN(0), new BN(0))
                    )
                    // Filter duplicates
                    .filter(
                      (tokenAmount) =>
                        !alreadyIncludedTokens.some((ta) =>
                          ta.mint.equals(tokenAmount.mint)
                        )
                    ),
                  [],
                  MAX_USER_PENDING_BASKET_TOKEN_AMOUNTS,
                  new TokenAmount(PublicKey.default, new BN(0), new BN(0)),
                  () => true
                );

              for (let i = 0; i < MAX_USER_PENDING_BASKET_TOKEN_AMOUNTS; i++) {
                assert.equal(
                  userPendingBasket.tokenAmounts[i].mint.toString(),
                  expectedTokenAmountsForUserPendingBasket[i].mint.toString()
                );
                assert.equal(
                  userPendingBasket.tokenAmounts[i].amountForMinting.eq(
                    expectedTokenAmountsForUserPendingBasket[i].amountForMinting
                  ),
                  true
                );
                // Amount for redeeming will be asserted below
              }

              // Assert redeeming amounts
              for (let i = 0; i < folioBasketTokens.length; i++) {
                // Both user and folio should have the same amount added from redeeming
                assert.equal(
                  basket.tokenAmounts[i].amountForRedeeming.eq(
                    basketBefore[i].amountForRedeeming.sub(
                      expectedTokenBalanceChanges[i]
                    )
                  ),
                  true
                );
                assert.equal(
                  userPendingBasket.tokenAmounts[i].amountForRedeeming.eq(
                    userPendingBasketBefore[i].amountForRedeeming.sub(
                      expectedTokenBalanceChanges[i]
                    )
                  ),
                  true
                );
              }

              // And assert transfer of token amounts
              await assertExpectedBalancesChanges(
                context,
                beforeUserBalances,
                [...folioBasketTokens.map((ta) => ta.mint)],
                [userKeypair.publicKey, folioPDA],
                [
                  // Amounts for user
                  ...expectedTokenBalanceChanges,
                  // Amounts for folio (inverse of user)
                  ...expectedTokenBalanceChanges.map((change) => change.neg()),
                ]
              );
            });
          }
        });
      }
    );
  });
});
