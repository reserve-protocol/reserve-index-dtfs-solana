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
  getAuctionEndsPDA,
} from "../../../utils/pda-helper";
import {
  addToPendingBasket,
  bid,
  killAuction as closeAuction,
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
  FolioTokenAmount,
  createAndSetRebalanceAccount,
  createAndSetAuctionEndsAccount,
  createAndSetDaoFeeConfig,
} from "../bankrun-account-helper";
import { Folio } from "../../../target/types/folio";
import {
  assertInvalidFolioStatusTestCase,
  assertNotValidRoleTestCase,
  GeneralTestCases,
} from "../bankrun-general-tests-helper";
import * as assert from "assert";
import { D18, D27, D9, DEFAULT_DECIMALS } from "../../../utils/constants";
import {
  assertExpectedBalancesChanges,
  getOrCreateAtaAddress,
  getTokenBalancesFromMints,
  initToken,
  mintToken,
} from "../bankrun-token-helper";
import { FolioAdmin } from "../../../target/types/folio_admin";
import {
  AccountType,
  createTransferInstruction,
  ExtensionType,
  getAccountLen,
  getTypeLen,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

/**
 * Tests for auction-related functionality in the Folio program, including:
 * - Bidding on auctions
 * - Auction closure
 * - Price limits and validation
 * - Token transfers during auctions
 */
describe("Bankrun - Bids and Kill Auction", () => {
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
  // These are owned by tokenProgram2022
  const MINTS_IN_FOLIO_2022 = [Keypair.generate(), Keypair.generate()];
  const BUY_MINTS_2022 = [Keypair.generate(), Keypair.generate()];

  const DEFAULT_BUY_MINT = BUY_MINTS[0];
  const DEFAULT_SELL_MINT = MINTS_IN_FOLIO[0];

  const VALID_AUCTION_ID = new BN(1);

  const VALID_AUCTION = new Auction(
    VALID_AUCTION_ID,
    new BN(1),
    new BN(1),
    new BN(1),
    folioPDA,
    DEFAULT_SELL_MINT.publicKey,
    DEFAULT_BUY_MINT.publicKey,
    new BN(0),
    new BN(1),
    { start: new BN(1).mul(D18), end: new BN(1).mul(D18) }
  );

  const DEFAULT_PARAMS: {
    remainingAccounts: () => AccountMeta[];

    customFolioTokenMint: Keypair;

    extraTokenAmountsForFolioBasket: FolioTokenAmount[];
    initialFolioBasket: FolioTokenAmount[];

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

    addMintOrTokenExtension: (
      ctx: ProgramTestContext,
      bidderBuyTokenAccount: PublicKey | null,
      buyMint: PublicKey
    ) => Promise<void>;
  } = {
    remainingAccounts: () => [],

    customFolioTokenMint: null,

    extraTokenAmountsForFolioBasket: [],

    initialFolioBasket: MINTS_IN_FOLIO.concat(MINTS_IN_FOLIO_2022).map(
      (mint) => ({
        mint: mint.publicKey,
        amount: new BN(100),
      })
    ),

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

    addMintOrTokenExtension: async () => {},
  };

  const TEST_CASE_CLOSE_AUCTION = [
    {
      desc: "(is valid)",
      expectedError: null,
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

    for (const mint of MINTS_IN_FOLIO.concat(MINTS_IN_FOLIO_2022)) {
      const isToken2022 = MINTS_IN_FOLIO_2022.map((m) =>
        m.publicKey.toString()
      ).includes(mint.publicKey.toString());

      const tokenProgram = isToken2022
        ? TOKEN_2022_PROGRAM_ID
        : TOKEN_PROGRAM_ID;
      initToken(
        context,
        adminKeypair.publicKey,
        mint,
        DEFAULT_DECIMALS,
        undefined,
        tokenProgram
      );
      const amount =
        initialFolioBasket.find((t) => t.mint.equals(mint.publicKey))?.amount ||
        new BN(1_000);

      mintToken(
        context,
        mint.publicKey,
        amount.toNumber(),
        folioPDA,
        undefined,
        tokenProgram
      );

      // If you need pending amounts for specific tests, use extraTokenAmountsForFolioBasket
      const extraTokenAmount = extraTokenAmountsForFolioBasket.find((t) =>
        t.mint.equals(mint.publicKey)
      );
      if (extraTokenAmount) {
        mintToken(
          context,
          mint.publicKey,
          amount.add(extraTokenAmount.amount).toNumber(),
          folioPDA,
          undefined,
          tokenProgram
        );
      }
    }

    for (const mint of BUY_MINTS.concat(BUY_MINTS_2022)) {
      const isToken2022 = BUY_MINTS_2022.map((m) =>
        m.publicKey.toString()
      ).includes(mint.publicKey.toString());

      const tokenProgram = isToken2022
        ? TOKEN_2022_PROGRAM_ID
        : TOKEN_PROGRAM_ID;
      initToken(
        context,
        adminKeypair.publicKey,
        mint,
        DEFAULT_DECIMALS,
        undefined,
        tokenProgram
      );

      mintToken(
        context,
        mint.publicKey,
        1_000,
        bidderKeypair.publicKey,
        undefined,
        tokenProgram
      );
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
    const generalIxCloseAuction = () =>
      closeAuction<true>(
        banksClient,
        programFolio,
        rebalanceManagerKeypair,
        folioPDA,
        getAuctionPDA(folioPDA, rebalanceNonce, new BN(0)),
        rebalanceNonce,
        DEFAULT_SELL_MINT.publicKey,
        DEFAULT_BUY_MINT.publicKey,
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
        getAuctionPDA(folioPDA, rebalanceNonce, new BN(0)),
        rebalanceNonce,
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

    describe("should run general tests for kill auction", () => {
      beforeEach(async () => {
        await createAndSetRebalanceAccount(
          context,
          programFolio,
          folioPDA,
          undefined,
          undefined,
          rebalanceNonce
        );
        await createAndSetAuctionEndsAccount(
          context,
          programFolio,
          folioPDA,
          rebalanceNonce,
          DEFAULT_BUY_MINT.publicKey,
          DEFAULT_SELL_MINT.publicKey,
          new BN(1)
        );
        const auction = Auction.default(
          folioPDA,
          DEFAULT_BUY_MINT.publicKey,
          DEFAULT_SELL_MINT.publicKey
        );
        auction.id = new BN(0);
        auction.nonce = rebalanceNonce;

        await createAndSetAuction(context, programFolio, auction, folioPDA);
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

    describe("should run general tests for bid", () => {
      beforeEach(async () => {
        await createAndSetRebalanceAccount(
          context,
          programFolio,
          folioPDA,
          undefined,
          undefined,
          rebalanceNonce
        );
        await createAndSetAuctionEndsAccount(
          context,
          programFolio,
          folioPDA,
          rebalanceNonce,
          DEFAULT_BUY_MINT.publicKey,
          DEFAULT_SELL_MINT.publicKey,
          new BN(1)
        );
        const auction = Auction.default(
          folioPDA,
          DEFAULT_BUY_MINT.publicKey,
          DEFAULT_SELL_MINT.publicKey
        );
        auction.id = new BN(0);
        auction.nonce = rebalanceNonce;

        await createAndSetAuction(context, programFolio, auction, folioPDA);

        await createAndSetDaoFeeConfig(
          context,
          programFolioAdmin,
          adminKeypair.publicKey,
          new BN(100)
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

  describe("Specific Cases - Kill Auction", () => {
    TEST_CASE_CLOSE_AUCTION.forEach(
      ({ desc, expectedError, ...restOfParams }) => {
        let currentTime: BN;

        describe(`When ${desc}`, () => {
          const rebalanceNonce = new BN(1);
          let txnResult: BanksTransactionResultWithMeta;

          const { customFolioTokenMint, auctionToUse, initialFolioBasket } = {
            ...DEFAULT_PARAMS,
            ...restOfParams,
          };

          before(async () => {
            await initBaseCase(customFolioTokenMint, initialFolioBasket);
            await createAndSetRebalanceAccount(
              context,
              programFolio,
              folioPDA,
              undefined,
              undefined,
              rebalanceNonce
            );
            await createAndSetAuctionEndsAccount(
              context,
              programFolio,
              folioPDA,
              rebalanceNonce,
              DEFAULT_BUY_MINT.publicKey,
              DEFAULT_SELL_MINT.publicKey,
              new BN(1)
            );
            const auction = Auction.default(
              folioPDA,
              DEFAULT_BUY_MINT.publicKey,
              DEFAULT_SELL_MINT.publicKey
            );
            auction.id = auctionToUse.id;
            auction.nonce = rebalanceNonce;

            await createAndSetAuction(context, programFolio, auction, folioPDA);
            await travelFutureSlot(context);

            txnResult = await closeAuction<true>(
              banksClient,
              programFolio,
              rebalanceManagerKeypair,
              folioPDA,
              getAuctionPDA(folioPDA, rebalanceNonce, auctionToUse.id),
              rebalanceNonce,
              DEFAULT_SELL_MINT.publicKey,
              DEFAULT_BUY_MINT.publicKey,
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
                getAuctionPDA(folioPDA, rebalanceNonce, auctionToUse.id)
              );
              const auctionEndsAfter =
                await programFolio.account.auctionEnds.fetch(
                  getAuctionEndsPDA(
                    folioPDA,
                    rebalanceNonce,
                    auctionAfter.sellMint,
                    auctionAfter.buyMint
                  )
                );

              assert.equal(auctionAfter.end.lte(currentTime), true);
              assert.equal(auctionEndsAfter.endTime.lte(currentTime), true);
            });
          }
        });
      }
    );
  });

  const TEST_CASE_BID = [
    {
      desc: "(invalid folio token mint, errors out)",
      expectedError: "InvalidFolioTokenMint",
      auctionToUse: {
        ...VALID_AUCTION,
      },
      customFolioTokenMint: Keypair.generate(),
    },
    {
      desc: "(invalid auction sell token mint, errors out)",
      expectedError: "InvalidAuctionSellTokenMint",
      auctionToUse: {
        ...VALID_AUCTION,
      },
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
      folioTokenSupply: new BN(10_000),
      initialFolioBasket: MINTS_IN_FOLIO.map((mint) => ({
        mint: mint.publicKey,
        amount: new BN(1000).mul(D9),
      })),
      auctionToUse: {
        ...VALID_AUCTION,
        buyLimitSpot: new BN(10000).mul(D18).div(new BN(10_000)),
        sellLimitSpot: new BN(0),
      },
      sellAmount: new BN(1000),
      maxBuyAmount: new BN(10),
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
      expectedError: "InsufficientBalance",
      sellAmount: new BN(1000),
      maxBuyAmount: new BN(10000),
      callback: () => getCallback(DEFAULT_BUY_MINT.publicKey, new BN(900)),
    },
    {
      desc: "(folio buy token account amount > max buy balance, errors out)",
      expectedError: "InsufficientBalance",
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
        buyLimitSpot: new BN(10000).mul(D18).div(new BN(10_000)),
        sellLimitSpot: new BN(0),
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
        buyLimitSpot: new BN(10000).mul(D27).div(new BN(10_000)),
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
        buyLimitSpot: new BN(2000).mul(D27).div(new BN(10_000)),
        sellLimitSpot: new BN(0),
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
        buyLimitSpot: new BN(1000).mul(D27),
        sellLimitSpot: new BN(0),
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
        buyLimitSpot: new BN(1000).mul(D27),
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
      desc: "(is valid, if the sell mint is token 2022)",
      expectedError: null,
      sellAmount: new BN(1000),
      maxBuyAmount: new BN(10000),
      folioTokenSupply: new BN(10_000),
      auctionToUse: {
        ...VALID_AUCTION,
        buyLimitSpot: new BN(10000).mul(D18).div(new BN(10_000)),
        sellLimitSpot: new BN(0),
        sellMint: MINTS_IN_FOLIO_2022[0].publicKey,
      },
      sellMint: MINTS_IN_FOLIO_2022[0],
      expectedTokenBalanceChanges: [
        new BN(1000),
        new BN(1000).neg(),
        new BN(1000).neg(),
        new BN(1000),
      ],
    },
    {
      desc: "(is valid, if the buy mint is token 2022)",
      expectedError: null,
      sellAmount: new BN(1000),
      maxBuyAmount: new BN(10000),
      folioTokenSupply: new BN(10_000),
      auctionToUse: {
        ...VALID_AUCTION,
        buyLimitSpot: new BN(10000).mul(D18).div(new BN(10_000)),
        sellLimitSpot: new BN(0),
        buyMint: BUY_MINTS_2022[0].publicKey,
      },
      buyMint: BUY_MINTS_2022[0],
      expectedTokenBalanceChanges: [
        new BN(1000),
        new BN(1000).neg(),
        new BN(1000).neg(),
        new BN(1000),
      ],
    },
    {
      desc: "(is valid, if the buy mint and sell mint are token 2022)",
      expectedError: null,
      sellAmount: new BN(1000),
      maxBuyAmount: new BN(10000),
      folioTokenSupply: new BN(10_000),
      auctionToUse: {
        ...VALID_AUCTION,
        buyLimitSpot: new BN(10000).mul(D18).div(new BN(10_000)),
        sellLimitSpot: new BN(0),
        buyMint: BUY_MINTS_2022[0].publicKey,
        sellMint: MINTS_IN_FOLIO_2022[0].publicKey,
      },
      buyMint: BUY_MINTS_2022[0],
      sellMint: MINTS_IN_FOLIO_2022[0],
      expectedTokenBalanceChanges: [
        new BN(1000),
        new BN(1000).neg(),
        new BN(1000).neg(),
        new BN(1000),
      ],
    },
  ];

  describe("Specific Cases - Bid", () => {
    TEST_CASE_BID.forEach(({ desc, expectedError, ...restOfParams }) => {
      describe(`When ${desc}`, () => {
        const rebalanceNonce = new BN(1);
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
        let sellTokenProgram: PublicKey;
        let buyTokenProgram: PublicKey;

        before(async () => {
          const mintToUse = customFolioTokenMint || folioTokenMint;
          initialFolioBasket.forEach((token) => {
            if (token.mint.equals(sellMint.publicKey)) {
              token.amount = folioSellBalance ?? new BN(sellAmount);
            }
          });
          currentTime = new BN(
            (await context.banksClient.getClock()).unixTimestamp.toString()
          );

          const isSellToken2022 = MINTS_IN_FOLIO_2022.map((m) =>
            m.publicKey.toString()
          ).includes(sellMint.publicKey.toString());
          sellTokenProgram = isSellToken2022
            ? TOKEN_2022_PROGRAM_ID
            : TOKEN_PROGRAM_ID;

          const isBuyToken2022 = BUY_MINTS_2022.map((m) =>
            m.publicKey.toString()
          ).includes(buyMint.publicKey.toString());
          buyTokenProgram = isBuyToken2022
            ? TOKEN_2022_PROGRAM_ID
            : TOKEN_PROGRAM_ID;

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
            DEFAULT_DECIMALS,
            undefined,
            sellTokenProgram
          );
          initToken(
            context,
            adminKeypair.publicKey,
            buyMint,
            DEFAULT_DECIMALS,
            undefined,
            buyTokenProgram
          );

          if (beforeCallback) {
            await beforeCallback();
          }
          await createAndSetDaoFeeConfig(
            context,
            programFolioAdmin,
            adminKeypair.publicKey,
            new BN(0)
          );

          await createAndSetRebalanceAccount(
            context,
            programFolio,
            folioPDA,
            undefined,
            undefined,
            rebalanceNonce
          );
          await createAndSetAuctionEndsAccount(
            context,
            programFolio,
            folioPDA,
            rebalanceNonce,
            sellMint.publicKey,
            buyMint.publicKey,
            new BN(1)
          );
          const auction = Auction.default(
            folioPDA,
            buyMint.publicKey,
            sellMint.publicKey
          );
          auction.id = auctionToUse.id;
          auction.nonce = rebalanceNonce;
          auction.start = currentTime;
          auction.end = currentTime.add(new BN(1000000000));
          auction.sellLimitSpot = auctionToUse.sellLimitSpot;
          auction.buyLimitSpot = auctionToUse.buyLimitSpot;
          auction.prices.start = auctionToUse.prices.start;
          auction.prices.end = auctionToUse.prices.end;
          auction.buyMint = auctionToUse.buyMint;
          auction.sellMint = auctionToUse.sellMint;
          await createAndSetAuction(context, programFolio, auction, folioPDA);

          await travelFutureSlot(context);

          beforeTokenBalanceChanges = await getTokenBalancesFromMints(
            context,
            [sellMint.publicKey, buyMint.publicKey],
            [bidderKeypair.publicKey, folioPDA],
            [sellTokenProgram, buyTokenProgram]
          );
          const callbackFields = await callback();

          txnResult = await bid<true>(
            context,
            banksClient,
            programFolio,
            bidderKeypair, // Not permissioned
            folioPDA,
            mintToUse.publicKey,
            getAuctionPDA(folioPDA, rebalanceNonce, auctionToUse.id),
            rebalanceNonce,
            sellAmount,
            maxBuyAmount,
            callbackFields.data.length > 0,
            sellMint.publicKey,
            buyMint.publicKey,
            callbackFields.data,
            true,
            callbackFields.remainingAccounts,
            buyTokenProgram,
            sellTokenProgram
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
              expectedTokenBalanceChanges,
              [sellTokenProgram, buyTokenProgram]
            );

            const folioBasketAfter =
              await programFolio.account.folioBasket.fetch(
                getFolioBasketPDA(folioPDA)
              );

            if (sellOut) {
              // Basket removed token & auction end is set
              const auctionAfter = await programFolio.account.auction.fetch(
                getAuctionPDA(folioPDA, rebalanceNonce, auctionToUse.id)
              );

              const folioBasketSellMint =
                folioBasketAfter.basket.tokenAmounts.find((token) =>
                  token.mint.equals(sellMint.publicKey)
                );

              const currentTimeAfter = new BN(
                (await context.banksClient.getClock()).unixTimestamp.toString()
              );
              assert.equal(folioBasketSellMint, null);
              assert.equal(auctionAfter.end.lte(currentTimeAfter), true);

              const auctionEndsAfter =
                await programFolio.account.auctionEnds.fetch(
                  getAuctionEndsPDA(
                    folioPDA,
                    rebalanceNonce,
                    auctionAfter.sellMint,
                    auctionAfter.buyMint
                  )
                );
              assert.equal(
                auctionEndsAfter.endTime.lte(currentTimeAfter),
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

  describe("Specific Cases - Bid with Token2022", () => {
    const DEFAULTS_FOR_AUCTION_SETUP = {
      sellAmount: new BN(100000),
      maxBuyAmount: new BN(100000),
      folioTokenSupply: new BN(10_000),
      auctionToUse: {
        ...VALID_AUCTION,
        prices: {
          start: new BN(1).mul(D18),
          end: new BN(1).mul(D18),
        },
        buyLimitSpot: new BN(10000000).mul(D18).div(new BN(10_000)),
        sellLimitSpot: new BN(0),
        sellMint: MINTS_IN_FOLIO_2022[0].publicKey,
        buyMint: BUY_MINTS_2022[0].publicKey,
      },
      expectedTokenBalanceChanges: [
        new BN(1000),
        new BN(1000).neg(),
        new BN(1000).neg(),
        new BN(1000),
      ],
      sellMint: MINTS_IN_FOLIO_2022[0],
      buyMint: BUY_MINTS_2022[0],
    };

    const TOKEN_2022_SPECIAL_CASES = [
      {
        desc: "Should fail if MemoTransfer is present on `bidderBuyTokenAccount`",
        expectedError: "UnsupportedSPLToken",
        addMintOrTokenExtension: async (
          ctx: ProgramTestContext,
          bidderBuyTokenAccount: PublicKey | null,
          buyMint: PublicKey
        ) => {
          if (bidderBuyTokenAccount) {
            const accountLen = getAccountLen([ExtensionType.MemoTransfer]);
            const existingAccount = await ctx.banksClient.getAccount(
              bidderBuyTokenAccount
            );
            const existingData = Buffer.from(existingAccount.data);
            const lengthRequired = accountLen - existingData.length;
            const additionalData = Buffer.alloc(lengthRequired);
            // DATA IN SPL_2022:
            // ACCOUNT_DATA(eg. MINT/TOKENACCOUNT),
            // ACCOUNTYPE(eg. AccountType.Mint,
            // AccountType.Account),
            // EXTENSION_HEADER(eg. ExtensionType.MemoTransfer),
            // LENGTH_OF_EXTENSION_DATA(to get this use: getTypeLen(ExtensionType.MemoTransfer)),
            // DATA of extension, set according to the extension.
            // ..NEXT_EXTENSION_HEADER..repeat.

            // 1 bytes for account type, account type is `Account=2`
            additionalData.writeUInt8(AccountType.Account, 0);
            // 2 bytes for extension type extension type is `MemoTransfer` will be written at offset 2
            additionalData.writeUInt16LE(ExtensionType.MemoTransfer, 1);
            // 2 bytes for the size of data in MemoTransferExtension
            // Size of data for memo transfer is 1 byte
            additionalData.writeUInt16LE(0, 3);
            // Set MemoTransfer.requireIncomingTransferMemos to true.
            // additionalData.writeUInt8(1, 5);
            const finalData = Buffer.concat([existingData, additionalData]);
            ctx.setAccount(bidderBuyTokenAccount, {
              ...existingAccount,
              data: finalData,
            });
          }
        },
      },

      ...[
        ExtensionType.TransferFeeAmount,
        ExtensionType.ConfidentialTransferAccount,
        ExtensionType.CpiGuard,
        ExtensionType.TransferHookAccount,
        ExtensionType.NonTransferableAccount,
        ExtensionType.MemoTransfer,
      ].map((extension) => {
        return {
          desc: `Should fail if ${ExtensionType[extension]} is present on bidderBuyTokenAccount`,
          expectedError: "UnsupportedSPLToken",
          addMintOrTokenExtension: async (
            ctx: ProgramTestContext,
            bidderBuyTokenAccount: PublicKey | null,
            buyMint: PublicKey
          ) => {
            if (bidderBuyTokenAccount) {
              const accountLen = getAccountLen([extension]);
              const existingAccount = await ctx.banksClient.getAccount(
                bidderBuyTokenAccount
              );
              const existingData = Buffer.from(existingAccount.data);
              const lengthRequired = accountLen - existingData.length;
              const additionalData = Buffer.alloc(lengthRequired);
              // DATA IN SPL_2022:
              // ACCOUNT_DATA(eg. MINT/TOKENACCOUNT),
              // ACCOUNTYPE(eg. AccountType.Mint,
              // AccountType.Account),
              // EXTENSION_HEADER(eg. ExtensionType.MemoTransfer),
              // LENGTH_OF_EXTENSION_DATA(to get this use: getTypeLen(ExtensionType.MemoTransfer)),
              // DATA of extension, set according to the extension.
              // ..NEXT_EXTENSION_HEADER..repeat.

              // 1 bytes for account type, account type is `Account = 2`
              additionalData.writeUInt8(AccountType.Account, 0);
              // 2 bytes for extension type extension type is `MemoTransfer` will be written at offset 2
              additionalData.writeUInt16LE(extension, 1);
              // 2 bytes for the size of data in MemoTransferExtension
              // Size of data for memo transfer is 1 byte
              additionalData.writeUInt16LE(getTypeLen(extension), 3);
              // We don't set anything for the additional data of extension, as that is not checked in smart contract.
              const finalData = Buffer.concat([existingData, additionalData]);
              ctx.setAccount(bidderBuyTokenAccount, {
                ...existingAccount,
                data: finalData,
              });
            }
          },
        };
      }),

      {
        desc: "Should pass if only allowed extensions are present on `bidderBuyTokenAccount`",
        expectedError: null,
        addMintOrTokenExtension: async (
          ctx: ProgramTestContext,
          bidderBuyTokenAccount: PublicKey | null,
          buyMint: PublicKey
        ) => {
          if (bidderBuyTokenAccount) {
            const extenstionsToAdd = [
              ExtensionType.Uninitialized,
              ExtensionType.ImmutableOwner,
            ];
            const dataToEachForEachExtension = {
              [ExtensionType.Uninitialized]: (
                inputBuffer: Buffer,
                offset: number
              ) => {
                return offset;
              },

              [ExtensionType.ImmutableOwner]: (
                _inputBuffer: Buffer,
                offset: number
              ) => {
                return offset;
              },
              [ExtensionType.CpiGuard]: (
                inputBuffer: Buffer,
                offset: number
              ) => {
                inputBuffer.writeUInt8(1, offset); // Set CpiGuard.lockCpi to true.
                return offset + 1;
              },
              [ExtensionType.NonTransferableAccount]: (
                inputBuffer: Buffer,
                offset: number
              ) => {
                return offset + 1;
              },
            };

            const accountLen = getAccountLen(extenstionsToAdd);
            const existingAccount = await ctx.banksClient.getAccount(
              bidderBuyTokenAccount
            );
            const existingData = Buffer.from(existingAccount.data);
            const lengthRequired = accountLen - existingData.length;
            const additionalData = Buffer.alloc(lengthRequired);
            additionalData.writeUInt8(AccountType.Account, 0);
            let offset = 1;
            for (const extension of extenstionsToAdd) {
              additionalData.writeUInt16LE(extension, offset);
              offset += 2;
              additionalData.writeUInt16LE(getTypeLen(extension), offset);
              offset += 2;

              offset = dataToEachForEachExtension[extension](
                additionalData,
                offset
              );
            }
            const finalData = Buffer.concat([existingData, additionalData]);
            ctx.setAccount(bidderBuyTokenAccount, {
              ...existingAccount,
              data: finalData,
            });
          }
        },
      },
    ];

    TOKEN_2022_SPECIAL_CASES.forEach(
      ({ desc, expectedError, ...restOfParams }) => {
        describe(`When ${desc} `, () => {
          const rebalanceNonce = new BN(1);
          let txnResult: BanksTransactionResultWithMeta;

          const {
            customFolioTokenMint,
            auctionToUse,
            initialFolioBasket,
            sellAmount,
            maxBuyAmount,
            sellMint,
            buyMint,
            folioTokenSupply,
            addMintOrTokenExtension,
          } = {
            ...DEFAULT_PARAMS,
            ...DEFAULTS_FOR_AUCTION_SETUP,
            ...restOfParams,
          };

          let currentTime: BN;
          let sellTokenProgram: PublicKey;
          let buyTokenProgram: PublicKey;

          before(async () => {
            const mintToUse = customFolioTokenMint || folioTokenMint;
            initialFolioBasket.forEach((token) => {
              if (token.mint.equals(sellMint.publicKey)) {
                token.amount = new BN(sellAmount);
              }
            });
            currentTime = new BN(
              (await context.banksClient.getClock()).unixTimestamp.toString()
            );

            const isSellToken2022 = MINTS_IN_FOLIO_2022.map((m) =>
              m.publicKey.toString()
            ).includes(sellMint.publicKey.toString());
            sellTokenProgram = isSellToken2022
              ? TOKEN_2022_PROGRAM_ID
              : TOKEN_PROGRAM_ID;

            const isBuyToken2022 = BUY_MINTS_2022.map((m) =>
              m.publicKey.toString()
            ).includes(buyMint.publicKey.toString());
            buyTokenProgram = isBuyToken2022
              ? TOKEN_2022_PROGRAM_ID
              : TOKEN_PROGRAM_ID;

            await initBaseCase(mintToUse, initialFolioBasket, folioTokenSupply);

            initToken(
              context,
              adminKeypair.publicKey,
              sellMint,
              DEFAULT_DECIMALS,
              undefined,
              sellTokenProgram
            );
            initToken(
              context,
              adminKeypair.publicKey,
              buyMint,
              DEFAULT_DECIMALS,
              undefined,
              buyTokenProgram
            );
            await createAndSetDaoFeeConfig(
              context,
              programFolioAdmin,
              adminKeypair.publicKey,
              new BN(0)
            );

            await createAndSetRebalanceAccount(
              context,
              programFolio,
              folioPDA,
              undefined,
              undefined,
              rebalanceNonce
            );
            await createAndSetAuctionEndsAccount(
              context,
              programFolio,
              folioPDA,
              rebalanceNonce,
              sellMint.publicKey,
              buyMint.publicKey,
              new BN(1)
            );
            const auction = Auction.default(
              folioPDA,
              buyMint.publicKey,
              sellMint.publicKey
            );
            auction.id = auctionToUse.id;
            auction.nonce = rebalanceNonce;
            auction.start = currentTime;
            auction.end = currentTime.add(new BN(1000000000));
            auction.sellLimitSpot = auctionToUse.sellLimitSpot;
            auction.buyLimitSpot = auctionToUse.buyLimitSpot;
            auction.prices.start = auctionToUse.prices.start;
            auction.prices.end = auctionToUse.prices.end;
            auction.buyMint = auctionToUse.buyMint;
            auction.sellMint = auctionToUse.sellMint;
            await createAndSetAuction(context, programFolio, auction, folioPDA);

            await travelFutureSlot(context);

            const bidderBuyTokenAccount = await getOrCreateAtaAddress(
              context,
              buyMint.publicKey,
              bidderKeypair.publicKey,
              buyTokenProgram
            );
            await addMintOrTokenExtension(
              context,
              bidderBuyTokenAccount,
              buyMint.publicKey
            );

            txnResult = await bid<true>(
              context,
              banksClient,
              programFolio,
              bidderKeypair, // Not permissioned
              folioPDA,
              mintToUse.publicKey,
              getAuctionPDA(folioPDA, rebalanceNonce, auctionToUse.id),
              rebalanceNonce,
              sellAmount,
              maxBuyAmount,
              false,
              sellMint.publicKey,
              buyMint.publicKey,
              Buffer.from([]),
              true,
              [],
              buyTokenProgram,
              sellTokenProgram
            );
          });

          if (expectedError) {
            it("should fail with expected error", () => {
              assertError(txnResult, expectedError);
            });
          } else {
            it("should succeed", async () => {
              await travelFutureSlot(context);
              const folioBasketAfter =
                await programFolio.account.folioBasket.fetch(
                  getFolioBasketPDA(folioPDA)
                );

              const folioBasketBuyMint =
                folioBasketAfter.basket.tokenAmounts.find((token) =>
                  token.mint.equals(buyMint.publicKey)
                );

              assert.notEqual(folioBasketBuyMint, null);
            });
          }
        });
      }
    );
  });
});
