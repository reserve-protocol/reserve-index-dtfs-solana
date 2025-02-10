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
  getTradePDA,
} from "../../../utils/pda-helper";
import {
  approveTrade,
  bid,
  killTrade,
  openTrade,
  openTradePermissionless,
} from "../bankrun-ix-helper";
import {
  createAndSetFolio,
  Role,
  createAndSetActor,
  FolioStatus,
  createAndSetProgramRegistrar,
  createAndSetFolioBasket,
  TokenAmount,
  Trade,
  createAndSetTrade,
  closeAccount,
  TradeEnd,
} from "../bankrun-account-helper";
import { Folio } from "../../../target/types/folio";
import {
  assertInvalidFolioStatusTestCase,
  assertNotValidRoleTestCase,
  GeneralTestCases,
} from "../bankrun-general-tests-helper";
import * as assert from "assert";
import { DEFAULT_DECIMALS, MAX_TTL } from "../../../utils/constants";
import {
  assertExpectedBalancesChanges,
  getOrCreateAtaAddress,
  getTokenBalancesFromMints,
  initToken,
  mintToken,
} from "../bankrun-token-helper";
import { FolioAdmin } from "../../../target/types/folio_admin";
import { deserializeU256 } from "../../../utils/math-helper";
import { createTransferInstruction, TOKEN_PROGRAM_ID } from "@solana/spl-token";
describe("Bankrun - Folio migration", () => {
  let context: ProgramTestContext;
  let provider: BankrunProvider;
  let banksClient: BanksClient;

  let programFolio: Program<Folio>;
  let programFolioAdmin: Program<FolioAdmin>;
  let keys: any;

  let payerKeypair: Keypair;
  let adminKeypair: Keypair;

  let folioOwnerKeypair: Keypair;
  let tradeProposerKeypair: Keypair;
  let tradeLauncherKeypair: Keypair;
  let bidderKeypair: Keypair;

  let folioTokenMint: Keypair;

  let folioPDA: PublicKey;

  const MINTS_IN_FOLIO = [Keypair.generate(), Keypair.generate()];
  const BUY_MINTS = [Keypair.generate(), Keypair.generate()];

  const DEFAULT_BUY_MINT = BUY_MINTS[0];
  const DEFAULT_SELL_MINT = MINTS_IN_FOLIO[0];

  const VALID_TRADE_ID = new BN(1);

  const VALID_TRADE = new Trade(
    VALID_TRADE_ID,
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

    initialFolioBasket: TokenAmount[];

    buyMints: PublicKey[];
    sellMints: PublicKey[];

    tradeToUse: Trade;

    tradeId: BN;
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
      amountForMinting: new BN(100),
      amountForRedeeming: new BN(100),
    })),

    buyMints: BUY_MINTS.map((mint) => mint.publicKey),
    sellMints: MINTS_IN_FOLIO.map((mint) => mint.publicKey),

    tradeToUse: VALID_TRADE,

    tradeId: VALID_TRADE_ID,
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
  const TEST_CASE_APPROVE_TRADE = [
    {
      desc: "(invalid trade id (not current +1), errors out)",
      expectedError: "InvalidTradeId",
      tradeId: new BN(0),
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

  const TEST_CASE_KILL_TRADE = [
    {
      desc: "(is valid)",
      expectedError: null,
    },
  ];

  // Lots of the tests will be done via unit testing for validating the prices, limits, etc.
  const TEST_CASE_OPEN_TRADE = [
    {
      desc: "(is valid)",
      expectedError: null,
    },
  ];

  const TEST_CASE_OPEN_TRADE_PERMISSIONLESS = [
    {
      desc: "(current time < available at, errors out)",
      expectedError: "TradeCannotBeOpenedPermissionlesslyYet",
      availableAt: new BN(10),
    },
    // Same as open appart from the available at check
    ...TEST_CASE_OPEN_TRADE,
  ];

  const TEST_CASE_BID = [
    {
      desc: "(invalid folio token mint, errors out)",
      expectedError: "InvalidFolioTokenMint",
      customFolioTokenMint: Keypair.generate(),
    },
    {
      desc: "(invalid trade sell token mint, errors out)",
      expectedError: "InvalidTradeSellTokenMint",
      sellMint: Keypair.generate(),
    },
    {
      desc: "(invalid trade buy token mint, errors out)",
      expectedError: "InvalidTradeBuyTokenMint",
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
      // TODO fix max
      desc: "(is valid, sold out sell mint, updates trade end)",
      expectedError: null,
      sellAmount: new BN(8000),
      maxBuyAmount: new BN(1000000000000),
      sellOut: true,
      expectedTokenBalanceChanges: [
        new BN(8000),
        new BN(8000).neg(),
        new BN(8000).neg(),
        new BN(8000),
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
    initialFolioBasket: TokenAmount[] = [],
    folioTokenSupply: BN = new BN(10_000)
  ) {
    const folioTokenMintToUse = customFolioTokenMint || folioTokenMint;

    const tradeEnds = [...MINTS_IN_FOLIO, ...BUY_MINTS].map(
      (mint) => new TradeEnd(mint.publicKey, new BN(0))
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
      tradeEnds
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
      tradeProposerKeypair,
      folioPDA,
      Role.TradeProposer
    );

    await createAndSetActor(
      context,
      programFolio,
      tradeLauncherKeypair,
      folioPDA,
      Role.TradeLauncher
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

    // Reset the trade account
    await closeAccount(context, getTradePDA(folioPDA, new BN(0)));
    await closeAccount(context, getTradePDA(folioPDA, new BN(1)));
  }

  before(async () => {
    ({ keys, programFolio, programFolioAdmin, provider, context } =
      await getConnectors());

    banksClient = context.banksClient;

    payerKeypair = provider.wallet.payer;

    adminKeypair = Keypair.fromSecretKey(Uint8Array.from(keys.admin));

    folioOwnerKeypair = Keypair.generate();
    folioTokenMint = Keypair.generate();

    tradeProposerKeypair = Keypair.generate();
    tradeLauncherKeypair = Keypair.generate();
    bidderKeypair = Keypair.generate();

    await airdrop(context, payerKeypair.publicKey, 1000);
    await airdrop(context, adminKeypair.publicKey, 1000);
    await airdrop(context, folioOwnerKeypair.publicKey, 1000);
    await airdrop(context, tradeProposerKeypair.publicKey, 1000);
    await airdrop(context, tradeLauncherKeypair.publicKey, 1000);
    await airdrop(context, bidderKeypair.publicKey, 1000);

    folioPDA = getFolioPDA(folioTokenMint.publicKey);

    await initBaseCase();
  });

  describe("General Tests", () => {
    const generalIxApproveTrade = () =>
      approveTrade<true>(
        banksClient,
        programFolio,
        tradeProposerKeypair,
        folioPDA,
        Trade.default(
          folioPDA,
          DEFAULT_BUY_MINT.publicKey,
          DEFAULT_SELL_MINT.publicKey
        ),
        new BN(0),
        true
      );

    const generalIxKillTrade = () =>
      killTrade<true>(
        banksClient,
        programFolio,
        tradeProposerKeypair,
        folioPDA,
        getTradePDA(folioPDA, new BN(0)),
        true
      );

    const generalIxOpenTrade = () =>
      openTrade<true>(
        banksClient,
        programFolio,
        tradeLauncherKeypair,
        folioPDA,
        getTradePDA(folioPDA, new BN(0)),
        Trade.default(
          folioPDA,
          DEFAULT_BUY_MINT.publicKey,
          DEFAULT_SELL_MINT.publicKey
        ),
        true
      );

    const generalIxOpenTradePermissionless = () =>
      openTradePermissionless<true>(
        banksClient,
        programFolio,
        bidderKeypair,
        folioPDA,
        getTradePDA(folioPDA, new BN(0)),
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
        getTradePDA(folioPDA, new BN(0)),
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

    describe("should run general tests for approve trade", () => {
      it(`should run ${GeneralTestCases.NotRole}`, async () => {
        await assertNotValidRoleTestCase(
          context,
          programFolio,
          tradeProposerKeypair,
          folioPDA,
          generalIxApproveTrade,
          Role.TradeLauncher
        );
      });

      it(`should run ${GeneralTestCases.InvalidFolioStatus} for MIGRATING & KILLED & INITIALIZING`, async () => {
        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,
          generalIxApproveTrade,
          FolioStatus.Migrating
        );

        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,
          generalIxApproveTrade,
          FolioStatus.Killed
        );

        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,
          generalIxApproveTrade,
          FolioStatus.Initializing
        );
      });
    });

    describe("should run general tests for kill trade", () => {
      beforeEach(async () => {
        await createAndSetTrade(
          context,
          programFolio,
          Trade.default(
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
          tradeProposerKeypair,
          folioPDA,
          generalIxKillTrade,
          Role.TradeLauncher
        );
      });

      it(`should run ${GeneralTestCases.InvalidFolioStatus} for MIGRATING & KILLED`, async () => {
        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,
          generalIxKillTrade,
          FolioStatus.Migrating
        );

        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,
          generalIxKillTrade,
          FolioStatus.Killed
        );
      });
    });

    describe("should run general tests for open trade", () => {
      beforeEach(async () => {
        await createAndSetTrade(
          context,
          programFolio,
          Trade.default(
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
          tradeLauncherKeypair,
          folioPDA,
          generalIxOpenTrade,
          Role.TradeProposer
        );
      });

      it(`should run ${GeneralTestCases.InvalidFolioStatus} for MIGRATING & KILLED & INITIALIZING`, async () => {
        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,
          generalIxOpenTrade,
          FolioStatus.Migrating
        );

        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,
          generalIxOpenTrade,
          FolioStatus.Killed
        );

        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,
          generalIxOpenTrade,
          FolioStatus.Initializing
        );
      });
    });

    describe("should run general tests for open trade permissionless", () => {
      beforeEach(async () => {
        await createAndSetTrade(
          context,
          programFolio,
          Trade.default(
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
          generalIxOpenTradePermissionless,
          FolioStatus.Migrating
        );

        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,
          generalIxOpenTradePermissionless,
          FolioStatus.Killed
        );

        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,
          generalIxOpenTradePermissionless,
          FolioStatus.Initializing
        );
      });
    });

    describe("should run general tests for bid", () => {
      beforeEach(async () => {
        await createAndSetTrade(
          context,
          programFolio,
          Trade.default(
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

  describe("Specific Cases", () => {
    TEST_CASE_APPROVE_TRADE.forEach(
      ({ desc, expectedError, ...restOfParams }) => {
        describe(`When ${desc}`, () => {
          let txnResult: BanksTransactionResultWithMeta;

          const {
            customFolioTokenMint,
            tradeToUse,
            initialFolioBasket,
            tradeId,
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

            tradeToUse.id = tradeId;
            tradeToUse.buy = buyMint.publicKey;
            tradeToUse.sell = sellMint.publicKey;

            txnResult = await approveTrade<true>(
              banksClient,
              programFolio,
              tradeProposerKeypair,
              folioPDA,
              tradeToUse,
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

              const tradeAfter = await programFolio.account.trade.fetch(
                getTradePDA(folioPDA, tradeId)
              );
              const folio = await programFolio.account.folio.fetch(folioPDA);

              assert.equal(tradeAfter.id.eq(tradeToUse.id), true);
              assert.equal(
                tradeAfter.availableAt.eq(currentTime.add(folio.tradeDelay)),
                true
              );
              assert.equal(
                tradeAfter.launchTimeout.eq(currentTime.add(MAX_TTL)),
                true
              );
              assert.equal(tradeAfter.start.eq(new BN(0)), true);
              assert.equal(tradeAfter.end.eq(new BN(0)), true);
              assert.equal(
                deserializeU256(tradeAfter.k.value),
                BigInt(tradeToUse.k.toString())
              );
              assert.deepEqual(tradeAfter.folio, folioPDA);
              assert.deepEqual(tradeAfter.sell, sellMint.publicKey);
              assert.deepEqual(tradeAfter.buy, buyMint.publicKey);
              assert.equal(
                tradeAfter.sellLimit.high.eq(tradeToUse.sellLimit.high),
                true
              );
              assert.equal(
                tradeAfter.sellLimit.low.eq(tradeToUse.sellLimit.low),
                true
              );
              assert.equal(
                tradeAfter.sellLimit.spot.eq(tradeToUse.sellLimit.spot),
                true
              );
              assert.equal(
                tradeAfter.buyLimit.high.eq(tradeToUse.buyLimit.high),
                true
              );
              assert.equal(
                tradeAfter.buyLimit.low.eq(tradeToUse.buyLimit.low),
                true
              );
              assert.equal(
                tradeAfter.buyLimit.spot.eq(tradeToUse.buyLimit.spot),
                true
              );
              assert.equal(
                tradeAfter.startPrice.eq(tradeToUse.startPrice),
                true
              );
              assert.equal(tradeAfter.endPrice.eq(tradeToUse.endPrice), true);
            });
          }
        });
      }
    );

    TEST_CASE_KILL_TRADE.forEach(({ desc, expectedError, ...restOfParams }) => {
      describe(`When ${desc}`, () => {
        let txnResult: BanksTransactionResultWithMeta;

        const { customFolioTokenMint, tradeToUse, initialFolioBasket } = {
          ...DEFAULT_PARAMS,
          ...restOfParams,
        };

        let currentTime: BN;

        before(async () => {
          await initBaseCase(customFolioTokenMint, initialFolioBasket);

          await createAndSetTrade(context, programFolio, tradeToUse, folioPDA);

          await travelFutureSlot(context);

          currentTime = new BN(
            (await context.banksClient.getClock()).unixTimestamp.toString()
          );

          txnResult = await killTrade<true>(
            banksClient,
            programFolio,
            tradeProposerKeypair,
            folioPDA,
            getTradePDA(folioPDA, tradeToUse.id),
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

            const tradeAfter = await programFolio.account.trade.fetch(
              getTradePDA(folioPDA, tradeToUse.id)
            );
            const folioAfter = await programFolio.account.folio.fetch(folioPDA);

            assert.equal(tradeAfter.end.eq(new BN(1)), true);

            const folioBuyMintTradeEnd = folioAfter.tradeEnds.find((tradeEnd) =>
              tradeEnd.mint.equals(tradeToUse.buy)
            );
            const folioSellMintTradeEnd = folioAfter.tradeEnds.find(
              (tradeEnd) => tradeEnd.mint.equals(tradeToUse.sell)
            );

            assert.equal(folioBuyMintTradeEnd.endTime.eq(currentTime), true);
            assert.equal(folioSellMintTradeEnd.endTime.eq(currentTime), true);
          });
        }
      });
    });

    TEST_CASE_OPEN_TRADE.forEach(({ desc, expectedError, ...restOfParams }) => {
      describe(`When ${desc}`, () => {
        let txnResult: BanksTransactionResultWithMeta;

        const {
          customFolioTokenMint,
          tradeToUse,
          initialFolioBasket,
          tradeId,
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
          tradeToUse.start = new BN(0);
          tradeToUse.end = new BN(0);
          tradeToUse.launchTimeout = currentTime.add(new BN(1000000000));

          await createAndSetTrade(context, programFolio, tradeToUse, folioPDA);

          await travelFutureSlot(context);

          currentTime = new BN(
            (await context.banksClient.getClock()).unixTimestamp.toString()
          );

          txnResult = await openTrade<true>(
            banksClient,
            programFolio,
            tradeLauncherKeypair,
            folioPDA,
            getTradePDA(folioPDA, tradeId),
            tradeToUse,
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

            const tradeAfter = await programFolio.account.trade.fetch(
              getTradePDA(folioPDA, tradeId)
            );
            const folio = await programFolio.account.folio.fetch(folioPDA);

            assert.equal(
              tradeAfter.sellLimit.spot.eq(tradeToUse.sellLimit.spot),
              true
            );
            assert.equal(
              tradeAfter.buyLimit.spot.eq(tradeToUse.buyLimit.spot),
              true
            );
            assert.equal(tradeAfter.startPrice.eq(tradeToUse.startPrice), true);
            assert.equal(tradeAfter.endPrice.eq(tradeToUse.endPrice), true);
            assert.equal(tradeAfter.start.eq(currentTime), true);
            assert.equal(
              tradeAfter.end.eq(currentTime.add(folio.auctionLength)),
              true
            );
            assert.equal(
              deserializeU256(tradeAfter.k.value),
              BigInt(tradeToUse.k.toString())
            );
          });
        }
      });
    });

    TEST_CASE_OPEN_TRADE_PERMISSIONLESS.forEach(
      ({ desc, expectedError, ...restOfParams }) => {
        describe(`When ${desc}`, () => {
          let txnResult: BanksTransactionResultWithMeta;

          const {
            customFolioTokenMint,
            tradeToUse,
            initialFolioBasket,
            tradeId,
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
            tradeToUse.start = new BN(0);
            tradeToUse.end = new BN(0);
            tradeToUse.availableAt = currentTime.add(availableAt);

            await createAndSetTrade(
              context,
              programFolio,
              tradeToUse,
              folioPDA
            );

            await travelFutureSlot(context);

            currentTime = new BN(
              (await context.banksClient.getClock()).unixTimestamp.toString()
            );

            txnResult = await openTradePermissionless<true>(
              banksClient,
              programFolio,
              bidderKeypair, // Not permissioned
              folioPDA,
              getTradePDA(folioPDA, tradeId),
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

              const tradeAfter = await programFolio.account.trade.fetch(
                getTradePDA(folioPDA, tradeId)
              );
              const folio = await programFolio.account.folio.fetch(folioPDA);

              assert.equal(
                tradeAfter.sellLimit.spot.eq(tradeToUse.sellLimit.spot),
                true
              );
              assert.equal(
                tradeAfter.buyLimit.spot.eq(tradeToUse.buyLimit.spot),
                true
              );
              assert.equal(
                tradeAfter.startPrice.eq(tradeToUse.startPrice),
                true
              );
              assert.equal(tradeAfter.endPrice.eq(tradeToUse.endPrice), true);
              assert.equal(tradeAfter.start.eq(currentTime), true);
              assert.equal(
                tradeAfter.end.eq(currentTime.add(folio.auctionLength)),
                true
              );
              assert.equal(
                deserializeU256(tradeAfter.k.value),
                BigInt(tradeToUse.k.toString())
              );
            });
          }
        });
      }
    );

    TEST_CASE_BID.forEach(({ desc, expectedError, ...restOfParams }) => {
      describe(`When ${desc}`, () => {
        let txnResult: BanksTransactionResultWithMeta;

        const {
          customFolioTokenMint,
          tradeToUse,
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

        let folioBasketTokensBefore: TokenAmount[];

        before(async () => {
          const mintToUse = customFolioTokenMint || folioTokenMint;

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

          tradeToUse.start = currentTime;
          tradeToUse.end = currentTime.add(new BN(1000000000));

          await createAndSetTrade(context, programFolio, tradeToUse, folioPDA);

          await travelFutureSlot(context);

          beforeTokenBalanceChanges = await getTokenBalancesFromMints(
            context,
            [sellMint.publicKey, buyMint.publicKey],
            [bidderKeypair.publicKey, folioPDA]
          );

          const folioBasketBefore =
            await programFolio.account.folioBasket.fetch(
              getFolioBasketPDA(folioPDA)
            );
          folioBasketTokensBefore = folioBasketBefore.tokenAmounts;

          const callbackFields = await callback();

          txnResult = await bid<true>(
            context,
            banksClient,
            programFolio,
            bidderKeypair, // Not permissioned
            folioPDA,
            mintToUse.publicKey,
            getTradePDA(folioPDA, tradeToUse.id),
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
              // Basket removed token & trade ends are set & trade end is set
              // const folioAfter = await programFolio.account.folio.fetch(
              //   folioPDA
              // );
              // const tradeAfter = await programFolio.account.trade.fetch(
              //   getTradePDA(folioPDA, tradeToUse.id)
              // );
              // const folioBasketSellMint = folioBasketAfter.tokenAmounts.find(
              //   (token) => token.mint.equals(sellMint.publicKey)
              // );
              // const sellTradeEnd = folioAfter.tradeEnds.find((tradeEnd) =>
              //   tradeEnd.mint.equals(sellMint.publicKey)
              // );
              // const buyTradeEnd = folioAfter.tradeEnds.find((tradeEnd) =>
              //   tradeEnd.mint.equals(buyMint.publicKey)
              // );
              // TODO
              // assert.equal(folioBasketSellMint, null);
              // assert.equal(sellTradeEnd.endTime.eq(currentTime), true);
              // assert.equal(buyTradeEnd.endTime.eq(currentTime), true);
              // assert.equal(tradeAfter.end.eq(currentTime), true);
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
