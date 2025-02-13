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
  closeAccount,
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
  D9,
  DEFAULT_DECIMALS,
  MAX_DAO_FEE,
  MAX_FOLIO_TOKEN_AMOUNTS,
  MAX_MINT_FEE,
  MAX_USER_PENDING_BASKET_TOKEN_AMOUNTS,
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
import {
  addToPendingBasket,
  mintFolioToken,
  removeFromPendingBasket,
} from "../bankrun-ix-helper";
import {
  assertInvalidFolioStatusTestCase,
  GeneralTestCases,
} from "../bankrun-general-tests-helper";
import * as assert from "assert";
import { FolioAdmin } from "../../../target/types/folio_admin";

describe("Bankrun - Folio minting", () => {
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

  let feeRecipient: Keypair;

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
    remainingAccounts: () => AccountMeta[];
    customFolioTokenMint: Keypair | null;
    customFolioMintFee: BN | null;
    customDAOMintFee: BN | null;
    shares: BN;

    // Is Validated before sending the transaction
    isPreTransactionValidated: boolean;

    // Expected changes
    expectedFolioTokenBalanceChange: BN;
    expectedDaoFeeShares: BN;
    expectedFeeRecipientShares: BN;
    expectedTokenBalanceChanges: BN[];
  } = {
    alreadyIncludedTokens: [],
    tokens: [],
    folioBasketTokens: [],
    remainingAccounts: () => [],
    customFolioTokenMint: null,
    customFolioMintFee: null,
    customDAOMintFee: null,
    shares: new BN(0),
    // Is Validated before sending the transaction
    isPreTransactionValidated: false,

    // Expected changes
    expectedFolioTokenBalanceChange: new BN(0),
    expectedDaoFeeShares: new BN(0),
    expectedFeeRecipientShares: new BN(0),
    expectedTokenBalanceChanges: Array(MINTS.length).fill(new BN(0)),
  };

  const TEST_CASES_ADD_TO_PENDING_BASKET = [
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
      desc: "(user adding a token, but sends an amount more than he has in his balance, errors out)",
      expectedError: "InsufficientFunds",
      folioBasketTokens: [
        new TokenAmount(MINTS[0].publicKey, new BN(0), new BN(0)),
      ],
      tokens: [
        { mint: MINTS[0].publicKey, amount: new BN(10_000_000_000_000) },
      ],
    },
    {
      desc: "(user adding a token, but his pending basket is already full, errors out)",
      expectedError: "InvalidAddedTokenMints",
      folioBasketTokens: [
        new TokenAmount(MINTS[0].publicKey, new BN(0), new BN(0)),
      ],
      alreadyIncludedTokens: Array(MAX_USER_PENDING_BASKET_TOKEN_AMOUNTS)
        .fill(null)
        .map(
          () =>
            new TokenAmount(Keypair.generate().publicKey, new BN(0), new BN(0))
        ),
      tokens: [{ mint: MINTS[0].publicKey, amount: new BN(1_000_000_000) }],
    },
    {
      desc: "(user adding a token that doesn't exist in the folio, errors out)",
      expectedError: "InvalidAddedTokenMints",
      folioBasketTokens: [
        new TokenAmount(MINTS[0].publicKey, new BN(0), new BN(0)),
        new TokenAmount(MINTS[2].publicKey, new BN(0), new BN(0)),
        new TokenAmount(MINTS[3].publicKey, new BN(0), new BN(0)),
      ],
      tokens: [{ mint: MINTS[1].publicKey, amount: new BN(1_000_000_000) }],
    },
    {
      desc: "(user tries to add too many tokens at the same time, transaction size issue, errors out)",
      expectedError: "TransactionTooLarge",
      folioBasketTokens: MINTS.map(
        (mint) => new TokenAmount(mint.publicKey, new BN(0), new BN(0))
      ),
      // Tries to add all the tokens at the same time
      tokens: MINTS.map((mint) => ({
        mint: mint.publicKey,
        amount: new BN(1_000_000_000),
      })),
      isPreTransactionValidated: true,
    },
    {
      desc: "(user adding two tokens, one he had already added, other one is new, succeeds)",
      expectedError: null,
      folioBasketTokens: [
        new TokenAmount(MINTS[0].publicKey, new BN(1_000_000), new BN(0)),
        new TokenAmount(MINTS[1].publicKey, new BN(0), new BN(0)),
      ],
      alreadyIncludedTokens: [
        new TokenAmount(MINTS[0].publicKey, new BN(1_000_000), new BN(0)),
      ],
      tokens: [
        { mint: MINTS[0].publicKey, amount: new BN(1_000_000_000) },
        { mint: MINTS[1].publicKey, amount: new BN(1_000_000_000) },
      ],
      expectedTokenBalanceChanges: [
        new BN(1_000_000_000).neg(),
        new BN(1_000_000_000).neg(),
      ],
      expectedFolioTokenBalanceChange: new BN(0),
    },
    {
      desc: "(user adds max amount tokens for transaction size, succeeds)",
      expectedError: "",
      folioBasketTokens: MINTS.slice(0, 5).map(
        (mint) => new TokenAmount(mint.publicKey, new BN(1_000_000), new BN(0))
      ),
      tokens: MINTS.slice(0, 5).map((mint) => ({
        mint: mint.publicKey,
        amount: new BN(1_000_000_000),
      })),
      expectedTokenBalanceChanges: Array(5).fill(new BN(1_000_000_000).neg()),
      expectedFolioTokenBalanceChange: new BN(0),
    },
  ];

  const TEST_CASES_REMOVE_FROM_PENDING_BASKET = [
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
      desc: "(recipient token account is not ATA of the user)",
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
      desc: "(user removing a token, but requesting a higher amount than he has in)",
      expectedError: "InsufficientFunds",
      folioBasketTokens: [
        new TokenAmount(MINTS[0].publicKey, new BN(0), new BN(0)),
      ],
      alreadyIncludedTokens: [
        new TokenAmount(MINTS[0].publicKey, new BN(1_000_000), new BN(0)),
      ],
      tokens: [
        { mint: MINTS[0].publicKey, amount: new BN(10_000_000_000_000) },
      ],
    },
    {
      desc: "(user removing a token, isn't in the folio anymore, but is in his pending basket, succeeds)",
      expectedError: null,
      folioBasketTokens: [
        new TokenAmount(MINTS[0].publicKey, new BN(1_000_000), new BN(0)),
      ],
      alreadyIncludedTokens: [
        new TokenAmount(MINTS[1].publicKey, new BN(1_000_000), new BN(0)),
      ],
      tokens: [{ mint: MINTS[1].publicKey, amount: new BN(1_000_000) }],
    },
    {
      desc: "(user tries to remove too many tokens at the same time, transaction size issue, errors out)",
      expectedError: "TransactionTooLarge",
      folioBasketTokens: MINTS.map(
        (mint) => new TokenAmount(mint.publicKey, new BN(0), new BN(0))
      ),
      alreadyIncludedTokens: MINTS.map(
        (mint) => new TokenAmount(mint.publicKey, new BN(1_000_000), new BN(0))
      ),
      isPreTransactionValidated: true,
      tokens: MINTS.map((mint) => ({
        mint: mint.publicKey,
        amount: new BN(1_000_000),
      })),
    },
    {
      desc: "(user remove two tokens, one he had already removed part of, other one is new, succeeds)",
      expectedError: null,
      folioBasketTokens: [
        new TokenAmount(MINTS[0].publicKey, new BN(500_000), new BN(0)),
        new TokenAmount(MINTS[1].publicKey, new BN(1_000_000), new BN(0)),
      ],
      alreadyIncludedTokens: [
        new TokenAmount(MINTS[0].publicKey, new BN(500_000), new BN(0)),
        new TokenAmount(MINTS[1].publicKey, new BN(1_000_000), new BN(0)),
      ],
      tokens: [
        { mint: MINTS[0].publicKey, amount: new BN(500_000) },
        { mint: MINTS[1].publicKey, amount: new BN(1_000_000) },
      ],
      expectedTokenBalanceChanges: [new BN(500_000), new BN(1_000_000)],
      expectedFolioTokenBalanceChange: new BN(0),
    },
    {
      desc: "(user removes max amount tokens for transaction size, succeeds)",
      folioBasketTokens: MINTS.slice(0, 5).map(
        (mint) => new TokenAmount(mint.publicKey, new BN(1_000_000), new BN(0))
      ),
      alreadyIncludedTokens: MINTS.slice(0, 5).map(
        (mint) => new TokenAmount(mint.publicKey, new BN(1_000_000), new BN(0))
      ),
      tokens: MINTS.slice(0, 5).map((mint) => ({
        mint: mint.publicKey,
        amount: new BN(1_000_000),
      })),
      expectedTokenBalanceChanges: Array(5).fill(new BN(1_000_000)),
      expectedFolioTokenBalanceChange: new BN(0),
    },
  ];

  const TEST_CASES_MINT_FOLIO_TOKEN = [
    {
      desc: "(trying to mint, user providing the wrong folio mint, errors out)",
      expectedError: "InvalidFolioTokenMint",
      customFolioTokenMint: Keypair.generate(),
      folioBasketTokens: [
        new TokenAmount(MINTS[0].publicKey, new BN(1_000_000), new BN(0)),
      ],
      tokens: [{ mint: MINTS[0].publicKey, amount: new BN(1_000_000) }],
    },
    {
      desc: "(trying to mint, user is passing no remaining accounts, errors out)",
      expectedError: "InvalidNumberOfRemainingAccounts",
      folioBasketTokens: [
        new TokenAmount(MINTS[0].publicKey, new BN(1_000_000), new BN(0)),
        new TokenAmount(MINTS[1].publicKey, new BN(1_000_000), new BN(0)),
      ],
      alreadyIncludedTokens: [
        new TokenAmount(MINTS[0].publicKey, new BN(1_000_000), new BN(0)),
        new TokenAmount(MINTS[1].publicKey, new BN(1_000_000), new BN(0)),
      ],
      tokens: [],
      shares: new BN(1),
    },
    {
      desc: "(trying to mint, user is passing the wrong remaining accounts, errors out)",
      expectedError: "InvalidRecipientTokenAccount",
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
        new TokenAmount(MINTS[0].publicKey, new BN(1_000_000), new BN(0)),
        new TokenAmount(MINTS[1].publicKey, new BN(1_000_000), new BN(0)),
      ],
      alreadyIncludedTokens: [
        new TokenAmount(MINTS[0].publicKey, new BN(1_000_000), new BN(0)),
        new TokenAmount(MINTS[1].publicKey, new BN(1_000_000), new BN(0)),
      ],
      tokens: [
        { mint: MINTS[0].publicKey, amount: new BN(0) },
        { mint: MINTS[2].publicKey, amount: new BN(0) },
      ],
      shares: new BN(1),
    },
    {
      desc: "(trying to mint, user is missing some tokens that are part of the folio's basket)",
      expectedError: "MintMismatch",
      folioBasketTokens: [
        new TokenAmount(MINTS[0].publicKey, new BN(1_000_000), new BN(0)),
        new TokenAmount(MINTS[1].publicKey, new BN(1_000_000), new BN(0)),
      ],
      alreadyIncludedTokens: [
        new TokenAmount(MINTS[0].publicKey, new BN(1_000_000), new BN(0)),
      ],
      tokens: [
        { mint: MINTS[0].publicKey, amount: new BN(0) },
        { mint: MINTS[1].publicKey, amount: new BN(0) },
      ],
      shares: new BN(1),
    },
    {
      desc: "(user trying to mint more shares than he is allowed, errors out)",
      expectedError: "InvalidShareAmountProvided",
      folioBasketTokens: [
        new TokenAmount(MINTS[0].publicKey, new BN(1_000_000), new BN(0)),
        new TokenAmount(MINTS[1].publicKey, new BN(1_000_000), new BN(0)),
      ],
      alreadyIncludedTokens: [
        new TokenAmount(MINTS[0].publicKey, new BN(1_000_000), new BN(0)),
        new TokenAmount(MINTS[1].publicKey, new BN(1_000_000), new BN(0)),
      ],
      tokens: [
        { mint: MINTS[0].publicKey, amount: new BN(0) },
        { mint: MINTS[1].publicKey, amount: new BN(0) },
      ],
      shares: new BN(1_000_000_000),
    },
    // Can only mint 1_000_000 shares, because the folio token balance is 9999 tokens
    // from the minting in the init base function
    {
      desc: "(calculated dao fee shares are lower than min dao shares, so take minimum, succeeds)",
      expectedError: null,
      customDAOMintFee: new BN(100000000000000), //10 bps
      folioBasketTokens: [
        new TokenAmount(MINTS[0].publicKey, new BN(1_000_000), new BN(0)),
        new TokenAmount(MINTS[1].publicKey, new BN(1_000_000), new BN(0)),
      ],
      alreadyIncludedTokens: [
        new TokenAmount(MINTS[0].publicKey, new BN(1_000_000), new BN(0)),
        new TokenAmount(MINTS[1].publicKey, new BN(1_000_000), new BN(0)),
      ],
      tokens: [
        { mint: MINTS[0].publicKey, amount: new BN(0) },
        { mint: MINTS[1].publicKey, amount: new BN(0) },
      ],
      shares: new BN(1_000_000),
      expectedFolioTokenBalanceChange: new BN(1_000_000),
      // Total fee shares is 5% (max mint fee)
      expectedDaoFeeShares: new BN(1_500_000_000_000), // the 15 bps min fee floor, scaled in D18
      expectedFeeRecipientShares: new BN(48_500_000_000_000), // 4.85%
      expectedTokenBalanceChanges: [new BN(999_999), new BN(999_999)],
    },
    {
      desc: "(user claims max amount of shares he can, succeeds)",
      expectedError: null,
      folioBasketTokens: [
        new TokenAmount(MINTS[0].publicKey, new BN(1_000_000), new BN(0)),
        new TokenAmount(MINTS[1].publicKey, new BN(1_000_000), new BN(0)),
      ],
      alreadyIncludedTokens: [
        new TokenAmount(MINTS[0].publicKey, new BN(1_000_000), new BN(0)),
        new TokenAmount(MINTS[1].publicKey, new BN(1_000_000), new BN(0)),
      ],
      tokens: [
        { mint: MINTS[0].publicKey, amount: new BN(0) },
        { mint: MINTS[1].publicKey, amount: new BN(0) },
      ],
      shares: new BN(1_000_001),
      expectedFolioTokenBalanceChange: new BN(1_000_000),
      // Total fee share is 5%
      expectedDaoFeeShares: new BN(25_000_025_000_000), // 2.5% (which is max dao fee of 50%) (Scaled in d18)
      expectedFeeRecipientShares: new BN(25_000_025_000_000), // 2.5% (scaled in d18)
      expectedTokenBalanceChanges: [new BN(1_000_000), new BN(1_000_000)],
    },
    {
      desc: "(user claims, fee recipient should get fees as well, succeeds)",
      expectedError: null,
      customDAOMintFee: MAX_MINT_FEE,
      customFolioMintFee: MAX_MINT_FEE,
      folioBasketTokens: [
        new TokenAmount(MINTS[0].publicKey, new BN(1_000_000), new BN(0)),
        new TokenAmount(MINTS[1].publicKey, new BN(1_000_000), new BN(0)),
      ],
      alreadyIncludedTokens: [
        new TokenAmount(MINTS[0].publicKey, new BN(1_000_000), new BN(0)),
        new TokenAmount(MINTS[1].publicKey, new BN(1_000_000), new BN(0)),
      ],
      tokens: [
        { mint: MINTS[0].publicKey, amount: new BN(0) },
        { mint: MINTS[1].publicKey, amount: new BN(0) },
      ],
      shares: new BN(1_000_001),
      expectedFolioTokenBalanceChange: new BN(1_000_000),
      expectedDaoFeeShares: new BN(2_500_002_500_000), // 0.25% (scaled in d18)
      expectedFeeRecipientShares: new BN(47_500_047_500_000), // 4.75% (scaled in d18)
      expectedTokenBalanceChanges: [new BN(1_000_000), new BN(1_000_000)],
    },
  ];

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
    folioBasketTokens: TokenAmount[] = [],
    customFolioTokenMint: Keypair | null = null,
    customFolioTokenSupply: BN = new BN(0),
    customDAOMintFee: BN | null = null,
    customFolioMintFee: BN | null = null
  ) {
    await createAndSetDaoFeeConfig(
      context,
      programFolioAdmin,
      feeRecipient.publicKey,
      customDAOMintFee ?? MAX_DAO_FEE
    );

    await createAndSetFolio(
      context,
      programFolio,
      folioTokenMint.publicKey,
      FolioStatus.Initialized,
      customFolioMintFee
    );

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

    for (const mint of MINTS) {
      initToken(context, adminKeypair.publicKey, mint, DEFAULT_DECIMALS);

      // Mint 100 of each to user
      mintToken(context, mint.publicKey, 1_000, userKeypair.publicKey);
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
    await closeAccount(
      context,
      getUserPendingBasketPDA(folioPDA, userKeypair.publicKey)
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
    feeRecipient = Keypair.generate();
    userKeypair = Keypair.generate();

    await airdrop(context, payerKeypair.publicKey, 1000);
    await airdrop(context, adminKeypair.publicKey, 1000);
    await airdrop(context, folioOwnerKeypair.publicKey, 1000);
    await airdrop(context, feeRecipient.publicKey, 1000);
    await airdrop(context, userKeypair.publicKey, 1000);

    folioPDA = getFolioPDA(folioTokenMint.publicKey);

    await initBaseCase();
  });

  describe("General Tests", () => {
    const generalIxAddToPendingBasket = () =>
      addToPendingBasket<true>(
        context,
        banksClient,
        programFolio,
        userKeypair,
        folioPDA,
        [],

        true
      );

    const generalIxMintFolioToken = () =>
      mintFolioToken<true>(
        context,
        banksClient,
        programFolio,
        userKeypair,
        folioPDA,
        folioTokenMint.publicKey,
        [],
        new BN(0),

        true
      );

    beforeEach(async () => {
      await initBaseCase();
    });

    describe("should run general tests for add to pending basket", () => {
      it(`should run ${GeneralTestCases.InvalidFolioStatus} for both KILLED and INITIALIZING abnnd MIGRATING`, async () => {
        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,

          generalIxAddToPendingBasket,
          FolioStatus.Killed
        );

        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,

          generalIxAddToPendingBasket,
          FolioStatus.Initializing
        );

        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,
          generalIxAddToPendingBasket,
          FolioStatus.Migrating
        );
      });
    });

    describe("should run general tests for mint folio token", () => {
      beforeEach(async () => {
        await createAndSetUserPendingBasket(
          context,
          programFolio,
          folioPDA,
          userKeypair.publicKey,
          []
        );
      });

      it(`should run ${GeneralTestCases.InvalidFolioStatus} for both KILLED and INITIALIZING and MIGRATING`, async () => {
        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,

          generalIxMintFolioToken,
          FolioStatus.Killed
        );

        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,

          generalIxMintFolioToken,
          FolioStatus.Initializing
        );

        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,
          generalIxMintFolioToken,
          FolioStatus.Migrating
        );
      });
    });
  });

  describe("Specific Cases - Add to pending basket", () => {
    TEST_CASES_ADD_TO_PENDING_BASKET.forEach(
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
          } = {
            ...DEFAULT_PARAMS,
            ...restOfParams,
          };

          let beforeUserBalances: { owner: PublicKey; balances: bigint[] }[] =
            [];

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
              [
                folioTokenMint.publicKey,
                ...folioBasketTokens.map((ta) => ta.mint),
              ],
              [userKeypair.publicKey, folioPDA]
            );

            try {
              txnResult = await addToPendingBasket<true>(
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
                // Amount for minting will be asserted below
                assert.equal(
                  basket.tokenAmounts[i].amountForRedeeming.eq(
                    expectedTokenAmountsForFolioBasket[i].amountForRedeeming
                  ),
                  true
                );
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
                // Amount for minting will be asserted below
                assert.equal(
                  userPendingBasket.tokenAmounts[i].amountForRedeeming.eq(
                    expectedTokenAmountsForUserPendingBasket[i]
                      .amountForRedeeming
                  ),
                  true
                );
              }

              // And assert transfer of token amounts
              await assertExpectedBalancesChanges(
                context,
                beforeUserBalances,
                [
                  folioTokenMint.publicKey,
                  ...folioBasketTokens.map((ta) => ta.mint),
                ],
                [userKeypair.publicKey, folioPDA],
                [
                  // Amounts for user
                  expectedFolioTokenBalanceChange,
                  ...expectedTokenBalanceChanges,
                  // Amounts for folio (inverse of user)
                  expectedFolioTokenBalanceChange.neg(),
                  ...expectedTokenBalanceChanges.map((change) => change.neg()),
                ]
              );
            });
          }
        });
      }
    );
  });

  describe("Specific Cases - Remove from pending basket", () => {
    TEST_CASES_REMOVE_FROM_PENDING_BASKET.forEach(
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
          } = {
            ...DEFAULT_PARAMS,
            ...restOfParams,
          };

          let beforeUserBalances: { owner: PublicKey; balances: bigint[] }[] =
            [];

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
              [
                folioTokenMint.publicKey,
                ...folioBasketTokens.map((ta) => ta.mint),
              ],
              [userKeypair.publicKey, folioPDA]
            );

            try {
              txnResult = await removeFromPendingBasket<true>(
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
                // Amount for minting will be asserted below
                assert.equal(
                  basket.tokenAmounts[i].amountForRedeeming.eq(
                    expectedTokenAmountsForFolioBasket[i].amountForRedeeming
                  ),
                  true
                );
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
                // Amount for minting will be asserted below
                assert.equal(
                  userPendingBasket.tokenAmounts[i].amountForRedeeming.eq(
                    expectedTokenAmountsForUserPendingBasket[i]
                      .amountForRedeeming
                  ),
                  true
                );
              }

              // And assert transfer of token amounts
              await assertExpectedBalancesChanges(
                context,
                beforeUserBalances,
                [
                  folioTokenMint.publicKey,
                  ...folioBasketTokens.map((ta) => ta.mint),
                ],
                [userKeypair.publicKey, folioPDA],
                [
                  // Amounts for user
                  expectedFolioTokenBalanceChange,
                  ...expectedTokenBalanceChanges,
                  // Amounts for folio (inverse of user)
                  expectedFolioTokenBalanceChange.neg(),
                  ...expectedTokenBalanceChanges.map((change) => change.neg()),
                ]
              );
            });
          }
        });
      }
    );
  });

  describe("Specific Cases - Mint folio token", () => {
    TEST_CASES_MINT_FOLIO_TOKEN.forEach(
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
            expectedDaoFeeShares,
            expectedFeeRecipientShares,
            expectedTokenBalanceChanges,
            customFolioTokenMint,
            shares,
            customDAOMintFee,
            customFolioMintFee,
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
              customDAOMintFee,
              customFolioMintFee
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
              [tokenMintToUse.publicKey],
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
              txnResult = await mintFolioToken<true>(
                context,
                banksClient,
                programFolio,
                userKeypair,
                folioPDA,
                tokenMintToUse.publicKey,
                tokens,
                shares,

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

              // Folio should have updated fees
              const folio = await programFolio.account.folio.fetch(folioPDA);

              assert.equal(
                folio.daoPendingFeeShares.eq(expectedDaoFeeShares),
                true
              );

              assert.equal(
                folio.feeRecipientsPendingFeeShares.eq(
                  expectedFeeRecipientShares
                ),
                true
              );

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
                // Amount for minting done below
                assert.equal(
                  basket.tokenAmounts[i].amountForRedeeming.eq(
                    expectedTokenAmountsForFolioBasket[i].amountForRedeeming
                  ),
                  true
                );
              }

              // User pending basket has changed amounts
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
                // Amount for minting done below
                assert.equal(
                  userPendingBasket.tokenAmounts[i].amountForRedeeming.eq(
                    expectedTokenAmountsForUserPendingBasket[i]
                      .amountForRedeeming
                  ),
                  true
                );
              }

              // Assertion for minting amouunt
              for (let i = 0; i < folioBasketTokens.length; i++) {
                // Both user and folio should have the same amount removed from minting
                assert.equal(
                  basket.tokenAmounts[i].amountForMinting.eq(
                    basketBefore[i].amountForMinting.sub(
                      expectedTokenBalanceChanges[i]
                    )
                  ),
                  true
                );
                assert.equal(
                  userPendingBasket.tokenAmounts[i].amountForMinting.eq(
                    userPendingBasketBefore[i].amountForMinting.sub(
                      expectedTokenBalanceChanges[i]
                    )
                  ),
                  true
                );
              }
              // And assert transfer of token amounts
              const tokenMintToUse = customFolioTokenMint || folioTokenMint;

              await assertExpectedBalancesChanges(
                context,
                beforeUserBalances,
                [tokenMintToUse.publicKey],
                [userKeypair.publicKey],
                [
                  // Amounts for user
                  expectedFolioTokenBalanceChange
                    .sub(expectedDaoFeeShares.div(D9)) // div by D9 to get in token amounts
                    .sub(expectedFeeRecipientShares.div(D9)), // div by D9 to get in token amounts
                ]
              );
            });
          }
        });
      }
    );
  });
});
