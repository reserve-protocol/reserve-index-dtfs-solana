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
} from "../bankrun-account-helper";
import { Folio } from "../../../target/types/folio";
import {
  assertInvalidFolioStatusTestCase,
  assertNotValidRoleTestCase,
  GeneralTestCases,
} from "../bankrun-general-tests-helper";
import * as assert from "assert";
import { D9, DEFAULT_DECIMALS, MAX_TTL } from "../../../utils/constants";
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
  let auctionApproverKeypair: Keypair;
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
    new BN(1),
    new BN(1),
    new BN(0),
    folioPDA,
    DEFAULT_SELL_MINT.publicKey,
    DEFAULT_BUY_MINT.publicKey,
    { low: new BN(1), high: new BN(1), spot: new BN(1) },
    { low: new BN(1), high: new BN(1), spot: new BN(1) },
    new BN(1),
    new BN(1)
  );

  const DEFAULT_PARAMS: {
    remainingAccounts: () => AccountMeta[];

    customFolioTokenMint: Keypair;

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

    folioTokenSupply: BN;

    sellOut: boolean;

    // Expected changes
    expectedTokenBalanceChanges: BN[];
  } = {
    remainingAccounts: () => [],

    customFolioTokenMint: null,

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

    folioTokenSupply: new BN(10_000),

    sellOut: false,

    // Expected changes
    expectedTokenBalanceChanges: Array(MINTS_IN_FOLIO.length).fill(new BN(0)),
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
  ];

  const TEST_CASE_OPEN_AUCTION_PERMISSIONLESS = [
    {
      desc: "(current time < available at, errors out)",
      expectedError: "AuctionCannotBeOpenedPermissionlesslyYet",
      availableAt: new BN(10),
    },
    // Same as open appart from the available at check
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
    folioTokenSupply: BN = new BN(10_000)
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

      mintToken(context, mint.publicKey, 1_000, folioPDA);
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
      auctionApproverKeypair,
      folioPDA,
      Role.AuctionApprover
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

    auctionApproverKeypair = Keypair.generate();
    auctionLauncherKeypair = Keypair.generate();
    bidderKeypair = Keypair.generate();

    await airdrop(context, payerKeypair.publicKey, 1000);
    await airdrop(context, adminKeypair.publicKey, 1000);
    await airdrop(context, folioOwnerKeypair.publicKey, 1000);
    await airdrop(context, auctionApproverKeypair.publicKey, 1000);
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
        auctionApproverKeypair,
        folioPDA,
        Auction.default(
          folioPDA,
          DEFAULT_BUY_MINT.publicKey,
          DEFAULT_SELL_MINT.publicKey
        ),
        new BN(0),
        true
      );

    const generalIxCloseAuction = () =>
      closeAuction<true>(
        banksClient,
        programFolio,
        auctionApproverKeypair,
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
          auctionApproverKeypair,
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
          auctionApproverKeypair,
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
          Role.AuctionApprover
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
              auctionApproverKeypair,
              folioPDA,
              auctionToUse,
              MAX_TTL,
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
              assert.equal(auctionAfter.start.eq(new BN(0)), true);
              assert.equal(auctionAfter.end.eq(new BN(0)), true);
              assert.equal(auctionAfter.k.eq(auctionToUse.k), true);
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
                auctionAfter.prices.start.eq(auctionToUse.prices.start),
                true
              );
              assert.equal(
                auctionAfter.prices.end.eq(auctionToUse.prices.end),
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
              auctionApproverKeypair,
              folioPDA,
              getAuctionPDA(folioPDA, auctionToUse.id),
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
                getAuctionPDA(folioPDA, auctionToUse.id)
              );

              assert.equal(auctionAfter.end.eq(new BN(1)), true);
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
            auctionToUse.start = new BN(0);
            auctionToUse.end = new BN(0);
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
                auctionAfter.prices.start.eq(auctionToUse.prices.start),
                true
              );
              assert.equal(
                auctionAfter.prices.end.eq(auctionToUse.prices.end),
                true
              );
              assert.equal(auctionAfter.start.eq(currentTime), true);
              assert.equal(
                auctionAfter.end.eq(currentTime.add(folio.auctionLength)),
                true
              );
              assert.equal(auctionAfter.k.eq(auctionToUse.k), true);
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
            auctionToUse.start = new BN(0);
            auctionToUse.end = new BN(0);
            auctionToUse.availableAt = currentTime.add(availableAt);

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
                auctionAfter.prices.start.eq(auctionToUse.prices.start),
                true
              );
              assert.equal(
                auctionAfter.prices.end.eq(auctionToUse.prices.end),
                true
              );
              assert.equal(auctionAfter.start.eq(currentTime), true);
              assert.equal(
                auctionAfter.end.eq(currentTime.add(folio.auctionLength)),
                true
              );
              assert.equal(auctionAfter.k.eq(auctionToUse.k), true);
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
              token.amount = new BN(sellAmount);
            }
          });

          await initBaseCase(mintToUse, initialFolioBasket, folioTokenSupply);

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

          auctionToUse.start = currentTime;
          auctionToUse.end = currentTime.add(new BN(1000000000));

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

              const folioBasketSellMint = folioBasketAfter.tokenAmounts.find(
                (token) => token.mint.equals(sellMint.publicKey)
              );

              assert.equal(folioBasketSellMint, null);
              assert.equal(auctionAfter.end.eq(currentTime), true);
            }

            // Buy mint should be added to the folio basket
            const folioBasketBuyMint = folioBasketAfter.tokenAmounts.find(
              (token) => token.mint.equals(buyMint.publicKey)
            );

            assert.notEqual(folioBasketBuyMint, null);
          });
        }
      });
    });
  });
});
