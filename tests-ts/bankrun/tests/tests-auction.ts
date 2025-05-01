import { BN, Program } from "@coral-xyz/anchor";
import { BankrunProvider } from "anchor-bankrun";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  BanksClient,
  BanksTransactionResultWithMeta,
  Clock,
  ProgramTestContext,
} from "solana-bankrun";
import {
  airdrop,
  assertError,
  getConnectors,
  travelFutureSlot,
} from "../bankrun-program-helper";

import {
  getFolioPDA,
  getAuctionPDA,
  getRebalancePDA,
  getAuctionEndsPDA,
} from "../../../utils/pda-helper";
import { openAuction, openAuctionPermissionless } from "../bankrun-ix-helper";
import {
  createAndSetFolio,
  Role,
  createAndSetActor,
  FolioStatus,
  createAndSetProgramRegistrar,
  createAndSetFolioBasket,
  Auction,
  closeAccount,
  FolioTokenAmount,
  createAndSetRebalanceAccount,
  createAndSetDaoFeeConfig,
  BasketRange,
  AuctionPrices,
} from "../bankrun-account-helper";
import { Folio } from "../../../target/types/folio";
import {
  assertInvalidFolioStatusTestCase,
  assertNotValidRoleTestCase,
  GeneralTestCases,
} from "../bankrun-general-tests-helper";
import {
  D18,
  D9,
  DEFAULT_DECIMALS,
  RESTRICTED_AUCTION_BUFFER,
} from "../../../utils/constants";
import {
  getOrCreateAtaAddress,
  initToken,
  mintToken,
} from "../bankrun-token-helper";
import { FolioAdmin } from "../../../target/types/folio_admin";
import assert from "assert";

/**
 * Tests for auction-related functionality in the Folio program, including:
 * - Opening auctions (both permissioned and permissionless)
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

  const EXISTING_REBALANCE_PARAMS = {
    nonce: new BN(1),
    currentAuctionId: new BN(0),
    allRebalanceDetailsAdded: true,
    auctionLauncherWindow: 100,
    ttl: 10000,
    existingTokensDetails: [
      {
        mint: DEFAULT_BUY_MINT.publicKey,
        basket: new BasketRange(
          new BN(80).mul(D18),
          new BN(1).mul(D18),
          new BN(100).mul(D18)
        ),
        prices: new AuctionPrices(new BN(1).mul(D18), new BN(1).mul(D18)),
      },
      {
        mint: DEFAULT_SELL_MINT.publicKey,
        basket: new BasketRange(
          new BN(0).mul(D18),
          new BN(0).mul(D18),
          new BN(0).mul(D18)
        ),
        prices: new AuctionPrices(new BN(1).mul(D18), new BN(1).mul(D18)),
      },
    ],
  };

  const DEFAULT_PARAMS: {
    auctionId: BN;
    extraTokenAmountsForFolioBasket: FolioTokenAmount[];
    initialFolioBasket: FolioTokenAmount[];
    buyMints: PublicKey[];
    sellMints: PublicKey[];
    buyMint: Keypair;
    sellMint: Keypair;
    rebalanceNonce: BN;
    folioTokenSupply: BN;
    existingRebalanceParams: {
      nonce: BN;
      currentAuctionId: BN;
      allRebalanceDetailsAdded: boolean;
      auctionLauncherWindow: number;
      ttl: number;
      existingTokensDetails: {
        mint: PublicKey;
        basket: BasketRange;
        prices: AuctionPrices;
      }[];
    };
    auctionConfig: {
      sellLimitSpot: BN;
      buyLimitSpot: BN;
      prices: {
        start: BN;
        end: BN;
      };
    };
    auctionLauncherWindowForPermissionless: number;
  } = {
    extraTokenAmountsForFolioBasket: [],
    auctionId: new BN(1),
    initialFolioBasket: MINTS_IN_FOLIO.map((mint) => ({
      mint: mint.publicKey,
      amount: new BN(100),
    })),

    buyMints: BUY_MINTS.map((mint) => mint.publicKey),
    sellMints: MINTS_IN_FOLIO.map((mint) => mint.publicKey),

    buyMint: DEFAULT_BUY_MINT,
    sellMint: DEFAULT_SELL_MINT,

    rebalanceNonce: new BN(1),
    folioTokenSupply: new BN(10_000),
    existingRebalanceParams: EXISTING_REBALANCE_PARAMS,
    auctionConfig: {
      sellLimitSpot: new BN(0),
      buyLimitSpot: new BN(2).mul(D18),
      prices: {
        start: new BN(1).mul(D18),
        end: new BN(1).mul(D18),
      },
    },
    auctionLauncherWindowForPermissionless: 0,
  };
  // Lots of the tests will be done via unit testing for validating the prices, limits, etc.
  const TEST_CASE_OPEN_AUCTION = [
    {
      desc: "(is valid)",
      expectedError: null,
    },

    {
      desc: "Fail if sell token is deficient",
      expectedError: "SellTokenNotSurplus",
      initialFolioBasket: [
        {
          mint: DEFAULT_SELL_MINT.publicKey,
          amount: new BN(0),
        },
      ],
    },
    {
      desc: "Fail if buy token is surplus",
      expectedError: "BuyTokenNotDeficit",
      existingRebalanceParams: {
        ...EXISTING_REBALANCE_PARAMS,
        existingTokensDetails: [
          {
            ...EXISTING_REBALANCE_PARAMS.existingTokensDetails[0],
            basket: new BasketRange(
              new BN(100).mul(D18),
              new BN(1).mul(D18).sub(new BN(1)),
              new BN(100).mul(D18)
            ),
          },
          {
            ...EXISTING_REBALANCE_PARAMS.existingTokensDetails[1],
          },
        ],
      },
      auctionConfig: {
        ...DEFAULT_PARAMS.auctionConfig,
        buyLimitSpot: new BN(1).mul(D18).sub(new BN(1)),
      },
      initialFolioBasket: [
        {
          mint: DEFAULT_SELL_MINT.publicKey,
          amount: new BN(1000000),
        },
        {
          mint: DEFAULT_BUY_MINT.publicKey,
          amount: new BN(10000000000).mul(D9),
        },
      ],
    },
  ];

  async function initBaseCase(
    initialFolioBasket: FolioTokenAmount[] = [],
    folioTokenSupply: BN = new BN(10_000),
    extraTokenAmountsForFolioBasket: FolioTokenAmount[] = []
  ) {
    const folioTokenMintToUse = folioTokenMint;

    await createAndSetFolio(
      context,
      programFolio,
      folioTokenMintToUse.publicKey,
      FolioStatus.Initialized,
      null,
      new BN(0),
      new BN(0),
      new BN(0),
      false
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
    await closeAccount(context, getAuctionPDA(folioPDA, new BN(0), new BN(0)));
    await closeAccount(context, getAuctionPDA(folioPDA, new BN(1), new BN(1)));

    // Required for poking in folio.
    await createAndSetDaoFeeConfig(
      context,
      programFolioAdmin,
      adminKeypair.publicKey,
      new BN(100)
    );
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
    const rebalanceNonce = new BN(1);
    const auctionId = new BN(1);
    const generalIxOpenAuction = () =>
      openAuction<true>(
        banksClient,
        programFolio,
        auctionLauncherKeypair,
        folioPDA,
        folioTokenMint.publicKey,
        rebalanceNonce,
        getAuctionPDA(folioPDA, rebalanceNonce, auctionId),
        Auction.default(
          folioPDA,
          DEFAULT_BUY_MINT.publicKey,
          DEFAULT_SELL_MINT.publicKey
        ),
        DEFAULT_SELL_MINT.publicKey,
        DEFAULT_BUY_MINT.publicKey,
        true
      );

    const generalIxOpenAuctionPermissionless = () =>
      openAuctionPermissionless<true>(
        banksClient,
        programFolio,
        bidderKeypair,
        folioPDA,
        folioTokenMint.publicKey,
        rebalanceNonce,
        getAuctionPDA(folioPDA, rebalanceNonce, auctionId),
        DEFAULT_SELL_MINT.publicKey,
        DEFAULT_BUY_MINT.publicKey,
        true
      );

    beforeEach(async () => {
      await initBaseCase();
      await createAndSetRebalanceAccount(
        context,
        programFolio,
        folioPDA,
        undefined,
        undefined,
        rebalanceNonce
      );
    });

    describe("should run general tests for open auction", () => {
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
  });

  describe("Specific Cases - Open Auction", () => {
    TEST_CASE_OPEN_AUCTION.forEach(
      ({ desc, expectedError, ...restOfParams }) => {
        describe(`When ${desc}`, () => {
          let txnResult: BanksTransactionResultWithMeta;

          const {
            initialFolioBasket,
            existingRebalanceParams,
            rebalanceNonce,
            auctionConfig,
            auctionId,
            sellMint,
            buyMint,
          } = {
            ...DEFAULT_PARAMS,
            ...restOfParams,
          };

          let currentTime: BN;
          let rebalanceBefore;

          before(async () => {
            await initBaseCase(initialFolioBasket);

            currentTime = new BN(
              (await context.banksClient.getClock()).unixTimestamp.toString()
            );

            await createAndSetRebalanceAccount(
              context,
              programFolio,
              folioPDA,
              existingRebalanceParams.allRebalanceDetailsAdded,
              existingRebalanceParams.currentAuctionId,
              existingRebalanceParams.nonce,
              currentTime,
              currentTime.add(
                new BN(existingRebalanceParams.auctionLauncherWindow)
              ),
              currentTime.add(new BN(existingRebalanceParams.ttl)),
              existingRebalanceParams.existingTokensDetails
            );

            await travelFutureSlot(context);

            currentTime = new BN(
              (await context.banksClient.getClock()).unixTimestamp.toString()
            );
            rebalanceBefore = await programFolio.account.rebalance.fetch(
              getRebalancePDA(folioPDA)
            );

            txnResult = await openAuction<true>(
              banksClient,
              programFolio,
              auctionLauncherKeypair,
              folioPDA,
              folioTokenMint.publicKey,
              rebalanceNonce,
              getAuctionPDA(folioPDA, rebalanceNonce, auctionId),
              auctionConfig,
              sellMint.publicKey,
              buyMint.publicKey,
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

              const rebalanceAfter = await programFolio.account.rebalance.fetch(
                getRebalancePDA(folioPDA)
              );
              const folio = await programFolio.account.folio.fetch(folioPDA);

              assert.equal(rebalanceAfter.currentAuctionId.eq(auctionId), true);
              assert.equal(
                rebalanceAfter.currentAuctionId
                  .sub(new BN(1))
                  .eq(rebalanceBefore.currentAuctionId),
                true
              );

              const auctionEnds = await programFolio.account.auctionEnds.fetch(
                getAuctionEndsPDA(
                  folioPDA,
                  rebalanceNonce,
                  sellMint.publicKey,
                  buyMint.publicKey
                )
              );

              const auction = await programFolio.account.auction.fetch(
                getAuctionPDA(folioPDA, rebalanceNonce, auctionId)
              );

              assert.equal(auctionEnds.endTime.eq(auction.end), true);
              assert.equal(
                auctionEnds.tokenMint1.equals(sellMint.publicKey) ||
                  auctionEnds.tokenMint2.equals(sellMint.publicKey),
                true
              );

              assert.equal(
                auctionEnds.tokenMint1.equals(buyMint.publicKey) ||
                  auctionEnds.tokenMint2.equals(buyMint.publicKey),
                true
              );

              assert.equal(
                auction.sellLimit.eq(auctionConfig.sellLimitSpot),
                true
              );
              assert.equal(
                auction.buyLimit.eq(auctionConfig.buyLimitSpot),
                true
              );
              assert.equal(
                auction.prices.start.eq(auctionConfig.prices.start),
                true
              );
              assert.equal(
                auction.prices.end.eq(auctionConfig.prices.end),
                true
              );
              assert.equal(
                auction.end.eq(currentTime.add(folio.auctionLength)),
                true
              );
              assert.equal(auction.start.eq(currentTime), true);

              // Updated rebalance details
              const sellDetailsAfter = rebalanceAfter.details.tokens.find(
                (detail) => detail.mint.equals(sellMint.publicKey)
              );
              assert.equal(
                sellDetailsAfter.limits.spot.eq(auctionConfig.sellLimitSpot),
                true
              );
              assert.equal(
                sellDetailsAfter.limits.high.eq(auctionConfig.sellLimitSpot),
                true
              );

              const buyDetailsAfter = rebalanceAfter.details.tokens.find(
                (detail) => detail.mint.equals(buyMint.publicKey)
              );

              assert.equal(
                buyDetailsAfter.limits.spot.eq(auctionConfig.buyLimitSpot),
                true
              );
              assert.equal(
                buyDetailsAfter.limits.low.eq(auctionConfig.buyLimitSpot),
                true
              );
            });
          }
        });
      }
    );
  });

  const TEST_CASE_OPEN_AUCTION_PERMISSIONLESS = [
    {
      desc: "(current time < available at, errors out)",
      auctionLauncherWindowForPermissionless: 10000,
      expectedError: "AuctionCannotBeOpenedPermissionlesslyYet",
    },
    // Same as open apart from the available at check
    ...TEST_CASE_OPEN_AUCTION,
  ];

  describe("Specific Cases - Open Auction Permissionless", () => {
    TEST_CASE_OPEN_AUCTION_PERMISSIONLESS.forEach(
      ({ desc, expectedError, ...restOfParams }) => {
        describe(`When ${desc}`, () => {
          let txnResult: BanksTransactionResultWithMeta;

          const {
            initialFolioBasket,
            rebalanceNonce,
            auctionId,
            sellMint,
            buyMint,
            existingRebalanceParams,
            auctionLauncherWindowForPermissionless,
          } = {
            ...DEFAULT_PARAMS,
            ...restOfParams,
          };

          let currentTime: BN;
          let rebalanceBefore;

          before(async () => {
            await initBaseCase(initialFolioBasket);

            await travelFutureSlot(context);
            currentTime = new BN(
              (await context.banksClient.getClock()).unixTimestamp.toString()
            );

            await createAndSetRebalanceAccount(
              context,
              programFolio,
              folioPDA,
              existingRebalanceParams.allRebalanceDetailsAdded,
              existingRebalanceParams.currentAuctionId,
              existingRebalanceParams.nonce,
              currentTime,
              currentTime.add(new BN(auctionLauncherWindowForPermissionless)),
              currentTime.add(new BN(existingRebalanceParams.ttl)),
              existingRebalanceParams.existingTokensDetails
            );

            rebalanceBefore = await programFolio.account.rebalance.fetch(
              getRebalancePDA(folioPDA)
            );
            await travelFutureSlot(context);

            const currentClock = await context.banksClient.getClock();

            const unixTimestamp =
              currentClock.unixTimestamp +
              // 2 minutes
              BigInt(RESTRICTED_AUCTION_BUFFER + 1);

            context.setClock(
              new Clock(
                currentClock.slot,
                currentClock.epochStartTimestamp,
                currentClock.epoch,
                currentClock.leaderScheduleEpoch,
                unixTimestamp
              )
            );

            currentTime = new BN(
              (await context.banksClient.getClock()).unixTimestamp.toString()
            );

            txnResult = await openAuctionPermissionless<true>(
              banksClient,
              programFolio,
              bidderKeypair, // Not permissioned
              folioPDA,
              folioTokenMint.publicKey,
              rebalanceNonce,
              getAuctionPDA(folioPDA, rebalanceNonce, auctionId),
              sellMint.publicKey,
              buyMint.publicKey,
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

              const rebalanceAfter = await programFolio.account.rebalance.fetch(
                getRebalancePDA(folioPDA)
              );
              const folio = await programFolio.account.folio.fetch(folioPDA);

              assert.equal(rebalanceAfter.currentAuctionId.eq(auctionId), true);
              assert.equal(
                rebalanceAfter.currentAuctionId
                  .sub(new BN(1))
                  .eq(rebalanceBefore.currentAuctionId),
                true
              );

              const auctionEnds = await programFolio.account.auctionEnds.fetch(
                getAuctionEndsPDA(
                  folioPDA,
                  rebalanceNonce,
                  sellMint.publicKey,
                  buyMint.publicKey
                )
              );

              const auction = await programFolio.account.auction.fetch(
                getAuctionPDA(folioPDA, rebalanceNonce, auctionId)
              );

              assert.equal(auctionEnds.endTime.eq(auction.end), true);
              assert.equal(
                auctionEnds.tokenMint1.equals(sellMint.publicKey) ||
                  auctionEnds.tokenMint2.equals(sellMint.publicKey),
                true
              );

              assert.equal(
                auctionEnds.tokenMint1.equals(buyMint.publicKey) ||
                  auctionEnds.tokenMint2.equals(buyMint.publicKey),
                true
              );

              const sellDetailsAfter = rebalanceBefore.details.tokens.find(
                (detail) => detail.mint.equals(sellMint.publicKey)
              );

              const buyDetailsAfter = rebalanceBefore.details.tokens.find(
                (detail) => detail.mint.equals(buyMint.publicKey)
              );

              assert.equal(
                auction.sellLimit.eq(sellDetailsAfter.limits.spot),
                true
              );
              assert.equal(
                auction.buyLimit.eq(buyDetailsAfter.limits.spot),
                true
              );
              assert.equal(
                auction.prices.start.eq(
                  sellDetailsAfter.prices.high
                    .mul(D18)
                    .div(buyDetailsAfter.prices.low)
                ),
                true
              );
              assert.equal(
                auction.prices.end.eq(
                  sellDetailsAfter.prices.low
                    .mul(D18)
                    .div(buyDetailsAfter.prices.high)
                ),
                true
              );
              assert.equal(
                auction.end.eq(currentTime.add(folio.auctionLength)),
                true
              );
              assert.equal(auction.start.eq(currentTime), true);
            });
          }
        });
      }
    );
  });
});
