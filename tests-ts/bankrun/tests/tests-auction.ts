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
  getConnectors,
  travelFutureSlot,
} from "../bankrun-program-helper";

import {
  getFolioBasketPDA,
  getFolioPDA,
  getAuctionPDA,
} from "../../../utils/pda-helper";
import {
  addToPendingBasket,
  approveAuction,
  bid,
  killAuction as closeAuction,
  openAuction,
  openAuctionPermissionless,
} from "../bankrun-ix-helper";
import {
  createAndSetFolio,
  Role,
  createAndSetActor,
  FolioStatus,
  createAndSetProgramRegistrar,
  createAndSetFolioBasket,
  Auction,
  createAndSetAuction,
  closeAccount,
  AuctionEnd,
  FolioTokenAmount,
  AuctionRunDetails,
} from "../bankrun-account-helper";
import { Folio } from "../../../target/types/folio";
import {
  assertInvalidFolioStatusTestCase,
  assertNotValidRoleTestCase,
  GeneralTestCases,
} from "../bankrun-general-tests-helper";
import * as assert from "assert";
import {
  D27,
  D9,
  DEFAULT_DECIMALS,
  MAX_SINGLE_AUCTION_RUNS,
  MAX_TTL,
} from "../../../utils/constants";
import {
  assertExpectedBalancesChanges,
  getOrCreateAtaAddress,
  getTokenBalancesFromMints,
  initToken,
  mintToken,
} from "../bankrun-token-helper";
import { FolioAdmin } from "../../../target/types/folio_admin";
import { createTransferInstruction, TOKEN_PROGRAM_ID } from "@solana/spl-token";

/**
 * Tests for auction-related functionality in the Folio program, including:
 * - Auction approval process
 * - Opening auctions (both permissioned and permissionless)
 * - Bidding on auctions
 * - Auction closure
 * - Price limits and validation
 * - Token transfers during auctions
 */

describe("Bankrun - Auction", () => {
  let context: ProgramTestContext;
  let provider: BankrunProvider;
  let banksClient: BanksClient;

  let programFolio: Program<Folio>;
  let programFolioAdmin: Program<FolioAdmin>;
  let keys: any;

  let payerKeypair: Keypair;
  let adminKeypair: Keypair;

  let folioOwnerKeypair: Keypair;
  let rebalanceManagerKeypair: Keypair;
  let auctionLauncherKeypair: Keypair;
  let bidderKeypair: Keypair;

  let folioTokenMint: Keypair;

  let folioPDA: PublicKey;

  const MINTS_IN_FOLIO = [Keypair.generate(), Keypair.generate()];
  const BUY_MINTS = [Keypair.generate(), Keypair.generate()];

  const DEFAULT_BUY_MINT = BUY_MINTS[0];
  const DEFAULT_SELL_MINT = MINTS_IN_FOLIO[0];

  const VALID_AUCTION_ID = new BN(1);

  const VALID_AUCTION = new Auction(
    VALID_AUCTION_ID,
    new BN(1),
    new BN(1),
    folioPDA,
    DEFAULT_SELL_MINT.publicKey,
    DEFAULT_BUY_MINT.publicKey,
    { low: new BN(1), high: new BN(1), spot: new BN(1) },
    { low: new BN(1), high: new BN(1), spot: new BN(1) },
    { start: new BN(1), end: new BN(1) },
    Array.from({ length: MAX_SINGLE_AUCTION_RUNS }, () =>
      AuctionRunDetails.default()
    ),
    1,
    0
  );

  const DEFAULT_PARAMS: {
    remainingAccounts: () => AccountMeta[];

    customFolioTokenMint: Keypair;

    extraTokenAmountsForFolioBasket: FolioTokenAmount[];
    initialFolioBasket: FolioTokenAmount[];

    buyMints: PublicKey[];
    sellMints: PublicKey[];

    auctionToUse: Auction;

    auctionId: BN;
    buyMint: Keypair;
    sellMint: Keypair;
    sellAmount: BN;
    maxBuyAmount: BN;
    availableAt: BN;
    callback: () => {
      data: Buffer;
      remainingAccounts: AccountMeta[];
    };
    beforeCallback: () => Promise<void>;

    folioTokenSupply: BN;

    // Tokens that are in folio basket of sell token
    folioSellBalance: BN | null;

    sellOut: boolean;

    // Expected changes
    expectedTokenBalanceChanges: BN[];
    // Index of the new run to use if the auction is reopened
    indexOfRun: number;
  } = {
    remainingAccounts: () => [],

    customFolioTokenMint: null,

    extraTokenAmountsForFolioBasket: [],

    initialFolioBasket: MINTS_IN_FOLIO.map((mint) => ({
      mint: mint.publicKey,
      amount: new BN(100),
    })),

    buyMints: BUY_MINTS.map((mint) => mint.publicKey),
    sellMints: MINTS_IN_FOLIO.map((mint) => mint.publicKey),

    auctionToUse: VALID_AUCTION,

    auctionId: VALID_AUCTION_ID,
    buyMint: DEFAULT_BUY_MINT,
    sellMint: DEFAULT_SELL_MINT,
    sellAmount: new BN(1),
    maxBuyAmount: new BN(1),
    availableAt: new BN(0),
    callback: () => ({
      data: Buffer.from([]),
      remainingAccounts: [],
    }),
    beforeCallback: () => Promise.resolve(),
    folioSellBalance: null,

    folioTokenSupply: new BN(10_000),

    sellOut: false,

    // Expected changes
    expectedTokenBalanceChanges: Array(MINTS_IN_FOLIO.length).fill(new BN(0)),
    indexOfRun: 0,
  };

  // Lots of the tests will be done via unit testing for validating the prices, limits, etc.
  const TEST_CASE_APPROVE_AUCTION = [
    {
      desc: "(invalid auction id (not current +1), errors out)",
      expectedError: "InvalidAuctionId",
      auctionId: new BN(0),
    },
    {
      desc: "(buy mint is the same as sell mint, errors out)",
      expectedError: "MintCantBeEqual",
      buyMint: DEFAULT_SELL_MINT,
      sellMint: DEFAULT_SELL_MINT,
    },
    {
      desc: "(is valid)",
      expectedError: null,
    },
  ];

  const TEST_CASE_CLOSE_AUCTION = [
    {
      desc: "(is valid)",
      expectedError: null,
    },
  ];

  // Lots of the tests will be done via unit testing for validating the prices, limits, etc.
  const TEST_CASE_OPEN_AUCTION = [
    {
      desc: "(is valid)",
      expectedError: null,
    },
    {
      desc: "(reopen auction with an auction already running, errors out)",
      expectedError: "AuctionCannotBeOpened",
      auctionToUse: {
        ...VALID_AUCTION,
        maxRuns: 2,
        closedForReruns: 0,
        auctionRunDetails: [
          {
            ...VALID_AUCTION.auctionRunDetails[0],
            start: new BN(1),
            end: new BN(10000000).mul(D9),
          },
          ...VALID_AUCTION.auctionRunDetails.slice(1),
        ],
      },
    },
    {
      desc: "(reopen auction with closed for reruns set to 1, errors out)",
      expectedError: "AuctionCannotBeOpened",
      auctionToUse: {
        ...VALID_AUCTION,
        maxRuns: 2,
        closedForReruns: 1,
      },
    },
    {
      desc: "(reopen auction, is valid)",
      expectedError: null,
      auctionToUse: {
        ...VALID_AUCTION,
        initialProposedPrice: {
          start: new BN(1),
          end: new BN(1),
        },
        maxRuns: 2,
        closedForReruns: 0,
        sellLimit: {
          spot: new BN(100),
          low: new BN(1),
          high: new BN(100),
        },
        buyLimit: {
          spot: new BN(100),
          low: new BN(1),
          high: new BN(100),
        },
        auctionRunDetails: [
          {
            ...VALID_AUCTION.auctionRunDetails[0],
            start: new BN(1),
            end: new BN(2),
            sellLimitSpot: new BN(100),
            buyLimitSpot: new BN(100),
          },
          ...VALID_AUCTION.auctionRunDetails.slice(1),
        ],
      },
      indexOfRun: 1,
    },
    {
      desc: "(reopen auction with max runs reached, errors out)",
      expectedError: "AuctionMaxRunsReached",
      auctionToUse: {
        ...VALID_AUCTION,
        maxRuns: 2,
        closedForReruns: 0,
        auctionRunDetails: [
          {
            ...VALID_AUCTION.auctionRunDetails[0],
            start: new BN(1),
            end: new BN(2),
          },
          {
            ...VALID_AUCTION.auctionRunDetails[1],
            start: new BN(3),
            end: new BN(4),
          },
          ...VALID_AUCTION.auctionRunDetails.slice(2),
        ],
      },
    },
  ];

  const TEST_CASE_OPEN_AUCTION_PERMISSIONLESS = [
    {
      desc: "(current time < available at, errors out)",
      expectedError: "AuctionCannotBeOpenedPermissionlesslyYet",
      availableAt: new BN(10),
    },
    // Same as open apart from the available at check
    ...TEST_CASE_OPEN_AUCTION,
  ];

  const TEST_CASE_BID = [
    {
      desc: "(invalid folio token mint, errors out)",
      expectedError: "InvalidFolioTokenMint",
      customFolioTokenMint: Keypair.generate(),
    },
    {
      desc: "(invalid auction sell token mint, errors out)",
      expectedError: "InvalidAuctionSellTokenMint",
      sellMint: Keypair.generate(),
    },
    {
      desc: "(invalid auction buy token mint, errors out)",
      expectedError: "InvalidAuctionBuyTokenMint",
      buyMint: Keypair.generate(),
    },
    {
      desc: "(bought amount is > max buy amount, errors out)",
      expectedError: "SlippageExceeded",
      sellAmount: new BN(2),
      maxBuyAmount: new BN(1),
    },
    {
      desc: "(sell amount > min sell balance, errors out)",
      expectedError: "InsufficientBalance",
      // Tokens that are in folio basket of sell token
      folioSellBalance: new BN(1000),
      sellAmount: new BN(1000000000001),
      maxBuyAmount: new BN(10000000000000),
    },
    {
      desc: "(with callback, invalid balance after, errors out)",
      expectedError: "InsufficientBid",
      sellAmount: new BN(1000),
      maxBuyAmount: new BN(10000),
      callback: () => getCallback(DEFAULT_BUY_MINT.publicKey, new BN(900)),
    },
    {
      desc: "(folio buy token account amount > max buy balance, errors out)",
      expectedError: "ExcessiveBid",
      folioTokenSupply: new BN(1),
      sellAmount: new BN(1000),
      maxBuyAmount: new BN(1000),
    },
    {
      desc: "(is valid without callback)",
      expectedError: null,
      sellAmount: new BN(1000),
      maxBuyAmount: new BN(10000),
      folioTokenSupply: new BN(10_000),
      auctionToUse: {
        ...VALID_AUCTION,
        buyLimit: {
          ...VALID_AUCTION.buyLimit,
          spot: new BN(10000).mul(D27).div(new BN(10_000)),
        },
      },
      expectedTokenBalanceChanges: [
        new BN(1000),
        new BN(1000).neg(),
        new BN(1000).neg(),
        new BN(1000),
      ],
    },
    {
      desc: "(is valid with callback)",
      expectedError: null,
      sellAmount: new BN(1000),
      maxBuyAmount: new BN(10000),
      folioTokenSupply: new BN(10_000),
      auctionToUse: {
        ...VALID_AUCTION,
        buyLimit: {
          ...VALID_AUCTION.buyLimit,
          spot: new BN(10000).mul(D27).div(new BN(10_000)),
        },
      },
      callback: () => getCallback(DEFAULT_BUY_MINT.publicKey, new BN(1000)),
      expectedTokenBalanceChanges: [
        new BN(1000),
        new BN(1000).neg(),
        new BN(1000).neg(),
        new BN(1000),
      ],
    },
    {
      desc: "(is valid, sold out sell mint, updates auction end)",
      expectedError: null,
      sellAmount: new BN(1000).mul(D9),
      maxBuyAmount: new BN(1000).mul(D9),
      folioTokenSupply: new BN(10_000),
      sellOut: true,
      auctionToUse: {
        ...VALID_AUCTION,
        buyLimit: {
          ...VALID_AUCTION.buyLimit,
          spot: new BN(1000).mul(D27),
        },
        sellLimit: {
          ...VALID_AUCTION.sellLimit,
          spot: new BN(0),
        },
      },
      initialFolioBasket: MINTS_IN_FOLIO.map((mint) => ({
        mint: mint.publicKey,
        amount: new BN(1000).mul(D9),
      })),
      extraTokenAmountsForFolioBasket: MINTS_IN_FOLIO.map((mint) => ({
        mint: mint.publicKey,
        amount: new BN(1000),
      })),
      expectedTokenBalanceChanges: [
        new BN(1000).mul(D9),
        new BN(1000).mul(D9).neg(),
        new BN(1000).mul(D9).neg(),
        new BN(1000).mul(D9),
      ],
    },
    // Should be able to bid
    {
      desc: "(Should not be effected by pending basket, if is valid, sold out sell mint, updates auction end)",
      expectedError: null,
      // With decimals
      sellAmount: new BN(1000).mul(D9),
      maxBuyAmount: new BN(1000000000000),
      sellOut: true,
      auctionToUse: {
        ...VALID_AUCTION,
        buyLimit: {
          ...VALID_AUCTION.buyLimit,
          spot: new BN(1000).mul(D27),
        },
      },
      expectedTokenBalanceChanges: [
        new BN(1000000000000),
        new BN(1000000000000).neg(),
        new BN(1000000000000).neg(),
        new BN(1000000000000),
      ],
      beforeCallback: async () => {
        // Add to pending basket
        await addToPendingBasket(
          context,
          banksClient,
          programFolio,
          bidderKeypair,
          folioPDA,
          [{ mint: DEFAULT_SELL_MINT.publicKey, amount: new BN(3000).mul(D9) }],
          true
        );
      },
    },
    // Should be able to bid
    {
      desc: "Should not be effected by pending basket, if is valid, sold out sell mint, updates auction end",
      expectedError: null,
      // With decimals
      sellAmount: new BN(1000).mul(D9),
      maxBuyAmount: new BN(1000000000000),
      sellOut: true,
      auctionToUse: {
        ...VALID_AUCTION,
        buyLimit: {
          ...VALID_AUCTION.buyLimit,
          spot: new BN(1000).mul(D9),
        },
      },
      expectedTokenBalanceChanges: [
        new BN(1000000000000),
        new BN(1000000000000).neg(),
        new BN(1000000000000).neg(),
        new BN(1000000000000),
      ],
      beforeCallback: async () => {
        // Add to pending basket
        await addToPendingBasket(
          context,
          banksClient,
          programFolio,
          bidderKeypair,
          folioPDA,
          [{ mint: DEFAULT_SELL_MINT.publicKey, amount: new BN(1000).mul(D9) }],
          true
        );
      },
    },
    {
      desc: "(is valid, sold out sell mint, updates auction end), for send auction run",
      expectedError: null,
      // With decimals
      sellAmount: new BN(1000).mul(D9),
      maxBuyAmount: new BN(1000000000000),
      sellOut: true,
      auctionToUse: {
        ...VALID_AUCTION,
        buyLimit: {
          ...VALID_AUCTION.buyLimit,
          spot: new BN(1000).mul(D9),
        },
        auctionRunDetails: [
          {
            ...VALID_AUCTION.auctionRunDetails[0],
            start: new BN(1),
            end: new BN(2),
            sellLimitSpot: new BN(100),
            buyLimitSpot: new BN(100),
          },
          {
            ...VALID_AUCTION.auctionRunDetails[0],
            buyLimitSpot: new BN(1000).mul(D9),
          },
          ...VALID_AUCTION.auctionRunDetails.slice(1),
        ],
      },
      indexOfRun: 1,
      expectedTokenBalanceChanges: [
        new BN(1000000000000),
        new BN(1000000000000).neg(),
        new BN(1000000000000).neg(),
        new BN(1000000000000),
      ],
    },
  ];

  async function getCallback(buyMint: PublicKey, transferAmount: BN) {
    const transferBuyTokenIx = createTransferInstruction(
      await getOrCreateAtaAddress(context, buyMint, bidderKeypair.publicKey),
      await getOrCreateAtaAddress(context, buyMint, folioPDA),
      bidderKeypair.publicKey,
      transferAmount.toNumber()
    );

    return {
      data: transferBuyTokenIx.data,
      remainingAccounts: [
        {
          isWritable: false,
          isSigner: false,
          pubkey: TOKEN_PROGRAM_ID,
        },
        ...transferBuyTokenIx.keys,
      ],
    };
  }

  async function initBaseCase(
    customFolioTokenMint: Keypair = null,
    initialFolioBasket: FolioTokenAmount[] = [],
    folioTokenSupply: BN = new BN(10_000),
    extraTokenAmountsForFolioBasket: FolioTokenAmount[] = []
  ) {
    const folioTokenMintToUse = customFolioTokenMint || folioTokenMint;

    const auctionEnds = [...MINTS_IN_FOLIO, ...BUY_MINTS].map(
      (mint) => new AuctionEnd(mint.publicKey, new BN(0))
    );

    await createAndSetFolio(
      context,
      programFolio,
      folioTokenMintToUse.publicKey,
      FolioStatus.Initialized,
      null,
      new BN(0),
      new BN(0),
      new BN(0),
      false,
      auctionEnds
    );

    await createAndSetFolioBasket(
      context,
      programFolio,
      folioPDA,
      initialFolioBasket
    );

    initToken(
      context,
      folioPDA,
      folioTokenMintToUse,
      DEFAULT_DECIMALS,
      folioTokenSupply
    );

    for (const mint of MINTS_IN_FOLIO) {
      initToken(context, adminKeypair.publicKey, mint, DEFAULT_DECIMALS);
      const amount =
        initialFolioBasket.find((t) => t.mint.equals(mint.publicKey))?.amount ||
        new BN(1_000);

      mintToken(context, mint.publicKey, amount.toNumber(), folioPDA);

      // If you need pending amounts for specific tests, use extraTokenAmountsForFolioBasket
      const extraTokenAmount = extraTokenAmountsForFolioBasket.find((t) =>
        t.mint.equals(mint.publicKey)
      );
      if (extraTokenAmount) {
        mintToken(
          context,
          mint.publicKey,
          amount.add(extraTokenAmount.amount).toNumber(),
          folioPDA
        );
      }
    }

    for (const mint of BUY_MINTS) {
      initToken(context, adminKeypair.publicKey, mint, DEFAULT_DECIMALS);

      mintToken(context, mint.publicKey, 1_000, bidderKeypair.publicKey);
    }

    await createAndSetActor(
      context,
      programFolio,
      folioOwnerKeypair,
      folioPDA,
      Role.Owner
    );

    await createAndSetActor(
      context,
      programFolio,
      rebalanceManagerKeypair,
      folioPDA,
      Role.RebalanceManager
    );

    await createAndSetActor(
      context,
      programFolio,
      auctionLauncherKeypair,
      folioPDA,
      Role.AuctionLauncher
    );

    await createAndSetProgramRegistrar(context, programFolioAdmin, [
      programFolio.programId,
    ]);

    // Default ATA for bidder and folio
    await getOrCreateAtaAddress(
      context,
      DEFAULT_BUY_MINT.publicKey,
      bidderKeypair.publicKey
    );

    await getOrCreateAtaAddress(context, DEFAULT_BUY_MINT.publicKey, folioPDA);

    await getOrCreateAtaAddress(
      context,
      DEFAULT_SELL_MINT.publicKey,
      bidderKeypair.publicKey
    );

    await getOrCreateAtaAddress(context, DEFAULT_SELL_MINT.publicKey, folioPDA);

    // Reset the auction account
    await closeAccount(context, getAuctionPDA(folioPDA, new BN(0)));
    await closeAccount(context, getAuctionPDA(folioPDA, new BN(1)));
  }

  before(async () => {
    ({ keys, programFolio, programFolioAdmin, provider, context } =
      await getConnectors());

    banksClient = context.banksClient;

    payerKeypair = provider.wallet.payer;

    adminKeypair = Keypair.fromSecretKey(Uint8Array.from(keys.admin));

    folioOwnerKeypair = Keypair.generate();
    folioTokenMint = Keypair.generate();

    rebalanceManagerKeypair = Keypair.generate();
    auctionLauncherKeypair = Keypair.generate();
    bidderKeypair = Keypair.generate();

    await airdrop(context, payerKeypair.publicKey, 1000);
    await airdrop(context, adminKeypair.publicKey, 1000);
    await airdrop(context, folioOwnerKeypair.publicKey, 1000);
    await airdrop(context, rebalanceManagerKeypair.publicKey, 1000);
    await airdrop(context, auctionLauncherKeypair.publicKey, 1000);
    await airdrop(context, bidderKeypair.publicKey, 1000);

    folioPDA = getFolioPDA(folioTokenMint.publicKey);

    await initBaseCase();
  });

  describe("General Tests", () => {
    const generalIxApproveAuction = () =>
      approveAuction<true>(
        banksClient,
        programFolio,
        rebalanceManagerKeypair,
        folioPDA,
        Auction.default(
          folioPDA,
          DEFAULT_BUY_MINT.publicKey,
          DEFAULT_SELL_MINT.publicKey
        ),
        new BN(0),
        1,
        true
      );

    const generalIxCloseAuction = () =>
      closeAuction<true>(
        banksClient,
        programFolio,
        rebalanceManagerKeypair,
        folioPDA,
        getAuctionPDA(folioPDA, new BN(0)),
        true
      );

    const generalIxOpenAuction = () =>
      openAuction<true>(
        banksClient,
        programFolio,
        auctionLauncherKeypair,
        folioPDA,
        getAuctionPDA(folioPDA, new BN(0)),
        Auction.default(
          folioPDA,
          DEFAULT_BUY_MINT.publicKey,
          DEFAULT_SELL_MINT.publicKey
        ),
        true
      );

    const generalIxOpenAuctionPermissionless = () =>
      openAuctionPermissionless<true>(
        banksClient,
        programFolio,
        bidderKeypair,
        folioPDA,
        getAuctionPDA(folioPDA, new BN(0)),
        true
      );

    const generalIxBid = () =>
      bid<true>(
        context,
        banksClient,
        programFolio,
        bidderKeypair,
        folioPDA,
        folioTokenMint.publicKey,
        getAuctionPDA(folioPDA, new BN(0)),
        new BN(0),
        new BN(0),
        false,
        DEFAULT_SELL_MINT.publicKey,
        DEFAULT_BUY_MINT.publicKey,
        Buffer.from([]),
        true
      );

    beforeEach(async () => {
      await initBaseCase();
    });

    describe("should run general tests for approve auction", () => {
      it(`should run ${GeneralTestCases.NotRole}`, async () => {
        await assertNotValidRoleTestCase(
          context,
          programFolio,
          rebalanceManagerKeypair,
          folioPDA,
          generalIxApproveAuction,
          Role.AuctionLauncher
        );
      });

      it(`should run ${GeneralTestCases.InvalidFolioStatus} for MIGRATING & KILLED & INITIALIZING`, async () => {
        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,
          generalIxApproveAuction,
          FolioStatus.Migrating
        );

        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,
          generalIxApproveAuction,
          FolioStatus.Killed
        );

        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,
          generalIxApproveAuction,
          FolioStatus.Initializing
        );
      });
    });

    describe("should run general tests for kill auction", () => {
      beforeEach(async () => {
        await createAndSetAuction(
          context,
          programFolio,
          Auction.default(
            folioPDA,
            DEFAULT_BUY_MINT.publicKey,
            DEFAULT_SELL_MINT.publicKey
          ),
          folioPDA
        );
      });

      it(`should run ${GeneralTestCases.NotRole}`, async () => {
        await assertNotValidRoleTestCase(
          context,
          programFolio,
          rebalanceManagerKeypair,
          folioPDA,
          generalIxCloseAuction,
          Role.BrandManager
        );
      });

      it(`should run ${GeneralTestCases.InvalidFolioStatus} for MIGRATING & KILLED`, async () => {
        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,
          generalIxCloseAuction,
          FolioStatus.Migrating
        );

        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,
          generalIxCloseAuction,
          FolioStatus.Killed
        );
      });
    });

    describe("should run general tests for open auction", () => {
      beforeEach(async () => {
        await createAndSetAuction(
          context,
          programFolio,
          Auction.default(
            folioPDA,
            DEFAULT_BUY_MINT.publicKey,
            DEFAULT_SELL_MINT.publicKey
          ),
          folioPDA
        );
      });

      it(`should run ${GeneralTestCases.NotRole}`, async () => {
        await assertNotValidRoleTestCase(
          context,
          programFolio,
          auctionLauncherKeypair,
          folioPDA,
          generalIxOpenAuction,
          Role.RebalanceManager
        );
      });

      it(`should run ${GeneralTestCases.InvalidFolioStatus} for MIGRATING & KILLED & INITIALIZING`, async () => {
        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,
          generalIxOpenAuction,
          FolioStatus.Migrating
        );

        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,
          generalIxOpenAuction,
          FolioStatus.Killed
        );

        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,
          generalIxOpenAuction,
          FolioStatus.Initializing
        );
      });
    });

    describe("should run general tests for open auction permissionless", () => {
      beforeEach(async () => {
        await createAndSetAuction(
          context,
          programFolio,
          Auction.default(
            folioPDA,
            DEFAULT_BUY_MINT.publicKey,
            DEFAULT_SELL_MINT.publicKey
          ),
          folioPDA
        );
      });

      it(`should run ${GeneralTestCases.InvalidFolioStatus} for MIGRATING & KILLED & INITIALIZING`, async () => {
        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,
          generalIxOpenAuctionPermissionless,
          FolioStatus.Migrating
        );

        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,
          generalIxOpenAuctionPermissionless,
          FolioStatus.Killed
        );

        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,
          generalIxOpenAuctionPermissionless,
          FolioStatus.Initializing
        );
      });
    });

    describe("should run general tests for bid", () => {
      beforeEach(async () => {
        await createAndSetAuction(
          context,
          programFolio,
          Auction.default(
            folioPDA,
            DEFAULT_BUY_MINT.publicKey,
            DEFAULT_SELL_MINT.publicKey
          ),
          folioPDA
        );
      });

      it(`should run ${GeneralTestCases.InvalidFolioStatus} for MIGRATING & KILLED & INITIALIZING`, async () => {
        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,
          generalIxBid,
          FolioStatus.Migrating
        );

        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,
          generalIxBid,
          FolioStatus.Killed
        );

        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,
          generalIxBid,
          FolioStatus.Initializing
        );
      });
    });
  });

  describe("Specific Cases - Approve Auction", () => {
    TEST_CASE_APPROVE_AUCTION.forEach(
      ({ desc, expectedError, ...restOfParams }) => {
        describe(`When ${desc}`, () => {
          let txnResult: BanksTransactionResultWithMeta;

          const {
            customFolioTokenMint,
            auctionToUse,
            initialFolioBasket,
            auctionId,
            buyMint,
            sellMint,
          } = {
            ...DEFAULT_PARAMS,
            ...restOfParams,
          };

          let currentTime: BN;

          before(async () => {
            await initBaseCase(customFolioTokenMint, initialFolioBasket);

            await travelFutureSlot(context);

            currentTime = new BN(
              (await context.banksClient.getClock()).unixTimestamp.toString()
            );

            auctionToUse.id = auctionId;
            auctionToUse.buy = buyMint.publicKey;
            auctionToUse.sell = sellMint.publicKey;

            txnResult = await approveAuction<true>(
              banksClient,
              programFolio,
              rebalanceManagerKeypair,
              folioPDA,
              auctionToUse,
              MAX_TTL,
              1,
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

              const auctionAfter = await programFolio.account.auction.fetch(
                getAuctionPDA(folioPDA, auctionId)
              );
              const folio = await programFolio.account.folio.fetch(folioPDA);

              assert.equal(auctionAfter.id.eq(auctionToUse.id), true);
              assert.equal(
                auctionAfter.availableAt.eq(
                  currentTime.add(folio.auctionDelay)
                ),
                true
              );
              assert.equal(
                auctionAfter.launchTimeout.eq(currentTime.add(MAX_TTL)),
                true
              );
              assert.equal(
                auctionAfter.auctionRunDetails[0].start.eq(new BN(0)),
                true
              );
              assert.equal(
                auctionAfter.auctionRunDetails[0].end.eq(new BN(0)),
                true
              );
              assert.equal(
                auctionAfter.auctionRunDetails[0].k.eq(
                  auctionToUse.auctionRunDetails[0].k
                ),
                true
              );
              assert.deepEqual(auctionAfter.folio, folioPDA);
              assert.deepEqual(auctionAfter.sell, sellMint.publicKey);
              assert.deepEqual(auctionAfter.buy, buyMint.publicKey);
              assert.equal(
                auctionAfter.sellLimit.high.eq(auctionToUse.sellLimit.high),
                true
              );
              assert.equal(
                auctionAfter.sellLimit.low.eq(auctionToUse.sellLimit.low),
                true
              );
              assert.equal(
                auctionAfter.sellLimit.spot.eq(auctionToUse.sellLimit.spot),
                true
              );
              assert.equal(
                auctionAfter.buyLimit.high.eq(auctionToUse.buyLimit.high),
                true
              );
              assert.equal(
                auctionAfter.buyLimit.low.eq(auctionToUse.buyLimit.low),
                true
              );
              assert.equal(
                auctionAfter.buyLimit.spot.eq(auctionToUse.buyLimit.spot),
                true
              );
              assert.equal(
                auctionAfter.buyLimit.spot.eq(auctionToUse.buyLimit.spot),
                true
              );

              assert.equal(
                auctionAfter.auctionRunDetails[0].prices.start.eq(
                  auctionToUse.auctionRunDetails[0].prices.start
                ),
                true
              );
              assert.equal(
                auctionAfter.auctionRunDetails[0].prices.end.eq(
                  auctionToUse.auctionRunDetails[0].prices.end
                ),
                true
              );
            });
          }
        });
      }
    );
  });

  describe("Specific Cases - Kill Auction", () => {
    TEST_CASE_CLOSE_AUCTION.forEach(
      ({ desc, expectedError, ...restOfParams }) => {
        let currentTime: BN;

        describe(`When ${desc}`, () => {
          let txnResult: BanksTransactionResultWithMeta;

          const { customFolioTokenMint, auctionToUse, initialFolioBasket } = {
            ...DEFAULT_PARAMS,
            ...restOfParams,
          };

          before(async () => {
            await initBaseCase(customFolioTokenMint, initialFolioBasket);

            await createAndSetAuction(
              context,
              programFolio,
              auctionToUse,
              folioPDA
            );

            await travelFutureSlot(context);

            txnResult = await closeAuction<true>(
              banksClient,
              programFolio,
              rebalanceManagerKeypair,
              folioPDA,
              getAuctionPDA(folioPDA, auctionToUse.id),
              true
            );
            currentTime = new BN(
              (await context.banksClient.getClock()).unixTimestamp.toString()
            );
          });

          if (expectedError) {
            it("should fail with expected error", () => {
              assertError(txnResult, expectedError);
            });
          } else {
            it("should succeed", async () => {
              await travelFutureSlot(context);

              const auctionAfter = await programFolio.account.auction.fetch(
                getAuctionPDA(folioPDA, auctionToUse.id)
              );

              assert.equal(
                auctionAfter.auctionRunDetails[0].end.lte(currentTime),
                true
              );
              assert.equal(auctionAfter.closedForReruns === 1, true);
            });
          }
        });
      }
    );
  });

  describe("Specific Cases - Open Auction", () => {
    TEST_CASE_OPEN_AUCTION.forEach(
      ({ desc, expectedError, ...restOfParams }) => {
        describe(`When ${desc}`, () => {
          let txnResult: BanksTransactionResultWithMeta;

          const {
            customFolioTokenMint,
            auctionToUse,
            initialFolioBasket,
            auctionId,
            indexOfRun,
          } = {
            ...DEFAULT_PARAMS,
            ...restOfParams,
          };

          let currentTime: BN;

          before(async () => {
            await initBaseCase(customFolioTokenMint, initialFolioBasket);

            currentTime = new BN(
              (await context.banksClient.getClock()).unixTimestamp.toString()
            );

            // Set as approved and ready to be opened
            auctionToUse.launchTimeout = currentTime.add(new BN(1000000000));

            await createAndSetAuction(
              context,
              programFolio,
              auctionToUse,
              folioPDA
            );

            await travelFutureSlot(context);

            currentTime = new BN(
              (await context.banksClient.getClock()).unixTimestamp.toString()
            );

            txnResult = await openAuction<true>(
              banksClient,
              programFolio,
              auctionLauncherKeypair,
              folioPDA,
              getAuctionPDA(folioPDA, auctionId),
              auctionToUse,
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

              const auctionAfter = await programFolio.account.auction.fetch(
                getAuctionPDA(folioPDA, auctionId)
              );
              const folio = await programFolio.account.folio.fetch(folioPDA);

              assert.equal(
                auctionAfter.sellLimit.spot.eq(auctionToUse.sellLimit.spot),
                true
              );
              assert.equal(
                auctionAfter.buyLimit.spot.eq(auctionToUse.buyLimit.spot),
                true
              );
              assert.equal(
                auctionAfter.auctionRunDetails[indexOfRun].prices.start.eq(
                  auctionToUse.initialProposedPrice.start
                ),
                true
              );
              assert.equal(
                auctionAfter.auctionRunDetails[indexOfRun].prices.end.eq(
                  auctionToUse.initialProposedPrice.end
                ),
                true
              );
              assert.equal(
                auctionAfter.auctionRunDetails[indexOfRun].start.eq(
                  currentTime
                ),
                true
              );
              assert.equal(
                auctionAfter.auctionRunDetails[indexOfRun].end.eq(
                  currentTime.add(folio.auctionLength)
                ),
                true
              );
              assert.equal(
                auctionAfter.auctionRunDetails[indexOfRun].k.eq(
                  auctionToUse.auctionRunDetails[indexOfRun].k
                ),
                true
              );
            });
          }
        });
      }
    );
  });

  describe("Specific Cases - Open Auction Permissionless", () => {
    TEST_CASE_OPEN_AUCTION_PERMISSIONLESS.forEach(
      ({ desc, expectedError, ...restOfParams }) => {
        describe(`When ${desc}`, () => {
          let txnResult: BanksTransactionResultWithMeta;

          const {
            customFolioTokenMint,
            auctionToUse,
            initialFolioBasket,
            auctionId,
            availableAt,
            indexOfRun,
          } = {
            ...DEFAULT_PARAMS,
            ...restOfParams,
          };

          let currentTime: BN;

          before(async () => {
            await initBaseCase(customFolioTokenMint, initialFolioBasket);

            currentTime = new BN(
              (await context.banksClient.getClock()).unixTimestamp.toString()
            );

            // Set as approved and ready to be opened (if available at is not provided)
            auctionToUse.availableAt = currentTime.add(availableAt);
            auctionToUse.launchTimeout = currentTime.add(new BN(1000000000));

            await createAndSetAuction(
              context,
              programFolio,
              auctionToUse,
              folioPDA
            );

            await travelFutureSlot(context);

            currentTime = new BN(
              (await context.banksClient.getClock()).unixTimestamp.toString()
            );

            txnResult = await openAuctionPermissionless<true>(
              banksClient,
              programFolio,
              bidderKeypair, // Not permissioned
              folioPDA,
              getAuctionPDA(folioPDA, auctionId),
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

              const auctionAfter = await programFolio.account.auction.fetch(
                getAuctionPDA(folioPDA, auctionId)
              );
              const folio = await programFolio.account.folio.fetch(folioPDA);

              assert.equal(
                auctionAfter.sellLimit.spot.eq(auctionToUse.sellLimit.spot),
                true
              );
              assert.equal(
                auctionAfter.buyLimit.spot.eq(auctionToUse.buyLimit.spot),
                true
              );
              assert.equal(
                auctionAfter.auctionRunDetails[indexOfRun].sellLimitSpot.eq(
                  indexOfRun == 0
                    ? auctionToUse.sellLimit.spot
                    : auctionAfter.auctionRunDetails[indexOfRun - 1]
                        .sellLimitSpot
                ),
                true
              );
              assert.equal(
                auctionAfter.auctionRunDetails[indexOfRun].buyLimitSpot.eq(
                  indexOfRun == 0
                    ? auctionToUse.buyLimit.spot
                    : auctionAfter.auctionRunDetails[indexOfRun - 1]
                        .buyLimitSpot
                ),
                true
              );
              assert.equal(
                auctionAfter.auctionRunDetails[indexOfRun].prices.start.eq(
                  auctionToUse.initialProposedPrice.start
                ),
                true
              );
              assert.equal(
                auctionAfter.auctionRunDetails[indexOfRun].prices.end.eq(
                  auctionToUse.initialProposedPrice.end
                ),
                true
              );
              assert.equal(
                auctionAfter.auctionRunDetails[indexOfRun].start.eq(
                  currentTime
                ),
                true
              );
              assert.equal(
                auctionAfter.auctionRunDetails[indexOfRun].end.eq(
                  currentTime.add(folio.auctionLength)
                ),
                true
              );
              assert.equal(
                auctionAfter.auctionRunDetails[indexOfRun].k.eq(
                  auctionToUse.auctionRunDetails[indexOfRun].k
                ),
                true
              );
            });
          }
        });
      }
    );
  });

  describe("Specific Cases - Bid", () => {
    TEST_CASE_BID.forEach(({ desc, expectedError, ...restOfParams }) => {
      describe(`When ${desc}`, () => {
        let txnResult: BanksTransactionResultWithMeta;

        const {
          customFolioTokenMint,
          auctionToUse,
          initialFolioBasket,
          sellAmount,
          maxBuyAmount,
          sellMint,
          buyMint,
          callback,
          expectedTokenBalanceChanges,
          folioTokenSupply,
          sellOut,
          extraTokenAmountsForFolioBasket,
          folioSellBalance,
          indexOfRun,
          beforeCallback,
        } = {
          ...DEFAULT_PARAMS,
          ...restOfParams,
        };

        let currentTime: BN;
        let beforeTokenBalanceChanges: {
          owner: PublicKey;
          balances: bigint[];
        }[];

        before(async () => {
          const mintToUse = customFolioTokenMint || folioTokenMint;
          initialFolioBasket.forEach((token) => {
            if (token.mint.equals(sellMint.publicKey)) {
              token.amount = folioSellBalance ?? new BN(sellAmount);
            }
          });

          await initBaseCase(
            mintToUse,
            initialFolioBasket,
            folioTokenSupply,
            extraTokenAmountsForFolioBasket
          );

          initToken(
            context,
            adminKeypair.publicKey,
            sellMint,
            DEFAULT_DECIMALS
          );
          initToken(context, adminKeypair.publicKey, buyMint, DEFAULT_DECIMALS);

          currentTime = new BN(
            (await context.banksClient.getClock()).unixTimestamp.toString()
          );

          auctionToUse.auctionRunDetails[indexOfRun].start = currentTime;
          auctionToUse.auctionRunDetails[indexOfRun].end = currentTime.add(
            new BN(1000000000)
          );
          auctionToUse.auctionRunDetails[indexOfRun].prices.start =
            auctionToUse.initialProposedPrice.start;
          auctionToUse.auctionRunDetails[indexOfRun].prices.end =
            auctionToUse.initialProposedPrice.end;
          auctionToUse.auctionRunDetails[indexOfRun].k = new BN(0);
          auctionToUse.auctionRunDetails[indexOfRun].buyLimitSpot =
            auctionToUse.buyLimit.spot;
          auctionToUse.auctionRunDetails[indexOfRun].sellLimitSpot =
            auctionToUse.sellLimit.spot;

          if (beforeCallback) {
            await beforeCallback();
          }

          await createAndSetAuction(
            context,
            programFolio,
            auctionToUse,
            folioPDA
          );

          await travelFutureSlot(context);

          beforeTokenBalanceChanges = await getTokenBalancesFromMints(
            context,
            [sellMint.publicKey, buyMint.publicKey],
            [bidderKeypair.publicKey, folioPDA]
          );

          const callbackFields = await callback();

          txnResult = await bid<true>(
            context,
            banksClient,
            programFolio,
            bidderKeypair, // Not permissioned
            folioPDA,
            mintToUse.publicKey,
            getAuctionPDA(folioPDA, auctionToUse.id),
            sellAmount,
            maxBuyAmount,
            callbackFields.data.length > 0,
            sellMint.publicKey,
            buyMint.publicKey,
            callbackFields.data,
            true,
            callbackFields.remainingAccounts
          );
        });

        if (expectedError) {
          it("should fail with expected error", () => {
            assertError(txnResult, expectedError);
          });
        } else {
          it("should succeed", async () => {
            await travelFutureSlot(context);

            await assertExpectedBalancesChanges(
              context,
              beforeTokenBalanceChanges,
              [sellMint.publicKey, buyMint.publicKey],
              [bidderKeypair.publicKey, folioPDA],
              expectedTokenBalanceChanges
            );

            const folioBasketAfter =
              await programFolio.account.folioBasket.fetch(
                getFolioBasketPDA(folioPDA)
              );

            if (sellOut) {
              // Basket removed token & auction end is set
              const auctionAfter = await programFolio.account.auction.fetch(
                getAuctionPDA(folioPDA, auctionToUse.id)
              );

              const folioBasketSellMint =
                folioBasketAfter.basket.tokenAmounts.find((token) =>
                  token.mint.equals(sellMint.publicKey)
                );

              const currentTimeAfter = new BN(
                (await context.banksClient.getClock()).unixTimestamp.toString()
              );
              assert.equal(folioBasketSellMint, null);
              assert.equal(
                auctionAfter.auctionRunDetails[indexOfRun].end.lte(
                  currentTimeAfter
                ),
                true
              );
            }

            // Buy mint should be added to the folio basket
            const folioBasketBuyMint =
              folioBasketAfter.basket.tokenAmounts.find((token) =>
                token.mint.equals(buyMint.publicKey)
              );

            assert.notEqual(folioBasketBuyMint, null);
          });
        }
      });
    });
  });
});
