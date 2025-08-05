import { BN, Program, Provider } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  airdrop,
  assertError,
  BanksTransactionResultWithMeta,
  getConnectors,
  travelFutureSlot,
} from "../bankrun-program-helper";

import { getFolioPDA, getRebalancePDA } from "../../../utils/pda-helper";
import { addRebalanceDetails, startRebalance } from "../bankrun-ix-helper";
import {
  createAndSetFolio,
  Role,
  createAndSetActor,
  FolioStatus,
  createAndSetProgramRegistrar,
  createAndSetFolioBasket,
  FolioTokenAmount,
  createAndSetRebalanceAccount,
  createAndSetDaoFeeConfig,
} from "../bankrun-account-helper";
import { Folio } from "../../../target/types/folio";
import {
  assertInvalidFolioStatusTestCase,
  assertNotValidRoleTestCase,
  GeneralTestCases,
} from "../bankrun-general-tests-helper";
import { assert } from "chai";
import { DEFAULT_DECIMALS, MAX_TTL } from "../../../utils/constants";
import {
  getOrCreateAtaAddress,
  initToken,
  mintToken,
} from "../bankrun-token-helper";
import { FolioAdmin } from "../../../target/types/folio_admin";
import { TestHelper } from "../../../utils/test-helper";
import {
  ACCOUNT_SIZE,
  AccountState,
  AccountType,
  ExtensionType,
  getMintLen,
  getTypeLen,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { LiteSVM } from "litesvm";

/**
 * Tests for starting rebalances
 * - Starting rebalances
 * - Adding rebalance details
 */
describe("Bankrun - Rebalance", () => {
  let context: LiteSVM;
  let provider: Provider;
  let banksClient: LiteSVM;

  let programFolio: Program<Folio>;
  let programFolioAdmin: Program<FolioAdmin>;
  let keys: any;

  let payerKeypair: Keypair;
  let adminKeypair: Keypair;

  let folioOwnerKeypair: Keypair;
  let rebalanceManagerKeypair: Keypair;
  let bidderKeypair: Keypair;

  let folioTokenMint: Keypair;

  let folioPDA: PublicKey;

  const MINTS_IN_FOLIO = [Keypair.generate(), Keypair.generate()];
  const BUY_MINTS = [Keypair.generate(), Keypair.generate()];
  const BUY_MINTS_2022 = [Keypair.generate()];

  const DEFAULT_BUY_MINT = BUY_MINTS[0];
  const DEFAULT_SELL_MINT = MINTS_IN_FOLIO[0];

  const DEFAULT_PARAMS: {
    auctionLauncherWindow: number;
    ttl: number;
    pricesAndLimits: {
      prices: { low: BN; high: BN };
      limits: { spot: BN; low: BN; high: BN };
    }[];
    mints: PublicKey[];
    allRebalanceDetailsAdded: boolean;
    existingRebalanceParams: {
      nonce: BN;
      currentAuctionId: BN;
      allRebalanceDetailsAdded: boolean;
      auctionLauncherWindow: number;
      ttl: number;
      startedAt: BN;
      restrictedUntil: BN;
      availableUntil: BN;
    } | null;
    addMintExtension: (ctx: LiteSVM, buyMint: PublicKey) => Promise<void>;
  } = {
    auctionLauncherWindow: 0,
    ttl: 0,
    pricesAndLimits: [],
    mints: [],
    allRebalanceDetailsAdded: false,
    existingRebalanceParams: null,
    addMintExtension: async (ctx: LiteSVM, buyMint: PublicKey) => {
      return;
    },
  };

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

    await createAndSetDaoFeeConfig(
      context,
      programFolioAdmin,
      adminKeypair.publicKey,
      new BN(1)
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

    for (const mint of BUY_MINTS_2022) {
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
        bidderKeypair.publicKey,
        DEFAULT_DECIMALS,
        TOKEN_2022_PROGRAM_ID
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
    await createAndSetProgramRegistrar(context, programFolioAdmin, [
      programFolio.programId,
    ]);

    await getOrCreateAtaAddress(context, DEFAULT_BUY_MINT.publicKey, folioPDA);

    await getOrCreateAtaAddress(context, DEFAULT_SELL_MINT.publicKey, folioPDA);
  }

  beforeEach(async () => {
    ({ keys, programFolio, programFolioAdmin, provider, context } =
      await getConnectors());

    banksClient = context;

    payerKeypair = provider.wallet.payer;

    adminKeypair = Keypair.fromSecretKey(Uint8Array.from(keys.admin));

    folioOwnerKeypair = Keypair.generate();
    folioTokenMint = Keypair.generate();

    rebalanceManagerKeypair = Keypair.generate();
    bidderKeypair = Keypair.generate();

    await airdrop(context, payerKeypair.publicKey, 1000);
    await airdrop(context, adminKeypair.publicKey, 1000);
    await airdrop(context, folioOwnerKeypair.publicKey, 1000);
    await airdrop(context, rebalanceManagerKeypair.publicKey, 1000);
    await airdrop(context, bidderKeypair.publicKey, 1000);

    folioPDA = getFolioPDA(folioTokenMint.publicKey);

    await initBaseCase();
  });

  describe("General Tests", () => {
    const generalIxStartRebalance = () =>
      startRebalance<true>(
        banksClient,
        programFolio,
        rebalanceManagerKeypair,
        folioPDA,
        folioTokenMint.publicKey,
        0,
        0,
        [
          {
            prices: {
              low: new BN(1),
              high: new BN(2),
            },
            limits: {
              spot: new BN(2),
              low: new BN(1),
              high: new BN(2),
            },
          },
          {
            prices: {
              low: new BN(1),
              high: new BN(2),
            },
            limits: {
              spot: new BN(2),
              low: new BN(1),
              high: new BN(2),
            },
          },
        ],
        true,
        [DEFAULT_BUY_MINT.publicKey, DEFAULT_SELL_MINT.publicKey]
      );

    const generalIxAddRebalanceDetails = () =>
      addRebalanceDetails<true>(
        banksClient,
        programFolio,
        rebalanceManagerKeypair,
        folioPDA,
        [
          {
            prices: {
              low: new BN(1),
              high: new BN(2),
            },
            limits: {
              spot: new BN(2),
              low: new BN(1),
              high: new BN(2),
            },
          },
          {
            prices: {
              low: new BN(1),
              high: new BN(2),
            },
            limits: {
              spot: new BN(2),
              low: new BN(1),
              high: new BN(2),
            },
          },
        ],
        true,
        [DEFAULT_BUY_MINT.publicKey, DEFAULT_SELL_MINT.publicKey]
      );

    beforeEach(async () => {
      await initBaseCase();
    });

    describe("should run general tests for starting rebalance", () => {
      it(`should run ${GeneralTestCases.NotRole}`, async () => {
        await assertNotValidRoleTestCase(
          context,
          programFolio,
          rebalanceManagerKeypair,
          folioPDA,
          generalIxStartRebalance,
          Role.BrandManager
        );
      });

      it(`should run ${GeneralTestCases.InvalidFolioStatus} for MIGRATING & KILLED & INITIALIZING`, async () => {
        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,
          generalIxStartRebalance,
          FolioStatus.Migrating
        );

        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,
          generalIxStartRebalance,
          FolioStatus.Killed
        );

        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,
          generalIxStartRebalance,
          FolioStatus.Initializing
        );
      });
    });

    describe("should run general tests for adding rebalance details", () => {
      beforeEach(async () => {
        await createAndSetRebalanceAccount(context, programFolio, folioPDA);
      });

      it(`should run ${GeneralTestCases.NotRole}`, async () => {
        await assertNotValidRoleTestCase(
          context,
          programFolio,
          rebalanceManagerKeypair,
          folioPDA,
          generalIxAddRebalanceDetails,
          Role.BrandManager
        );
      });

      it(`should run ${GeneralTestCases.InvalidFolioStatus} for MIGRATING & KILLED & INITIALIZING`, async () => {
        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,
          generalIxAddRebalanceDetails,
          FolioStatus.Migrating
        );

        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,
          generalIxAddRebalanceDetails,
          FolioStatus.Killed
        );

        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,
          generalIxAddRebalanceDetails,
          FolioStatus.Initializing
        );
      });
    });
  });

  const TEST_CASE_START_REBALANCE = [
    {
      desc: "should fail if ttl is greater than max ttl",
      expectedError: "RebalanceTTLExceeded",
      ttl: MAX_TTL.add(new BN(1)),
    },
    {
      desc: "should fail if auction launcher window is greater than ttl",
      expectedError: "RebalanceAuctionLauncherWindowTooLong",
      auctionLauncherWindow: MAX_TTL.add(new BN(1)),
      ttl: MAX_TTL,
    },
    {
      desc: "should fail if mints are provided but prices and limits are not",
      expectedError: "RebalanceMintsAndPricesAndLimitsLengthMismatch",
      mints: [DEFAULT_BUY_MINT.publicKey, DEFAULT_BUY_MINT.publicKey],
    },
    {
      desc: "Should fail is same mint is passed twice",
      expectedError: "RebalanceTokenAlreadyAdded",
      pricesAndLimits: [
        {
          prices: {
            low: new BN(1),
            high: new BN(2),
          },
          limits: {
            spot: new BN(2),
            low: new BN(1),
            high: new BN(2),
          },
        },
        {
          prices: {
            low: new BN(1),
            high: new BN(2),
          },
          limits: {
            spot: new BN(2),
            low: new BN(1),
            high: new BN(2),
          },
        },
      ],
      mints: [DEFAULT_BUY_MINT.publicKey, DEFAULT_BUY_MINT.publicKey],
    },
    {
      desc: "Should prices are deferred for the first token, adding price for the 2nd token should fail",
      expectedError: "InvalidPrices",
      pricesAndLimits: [
        {
          prices: {
            low: new BN(0),
            high: new BN(0),
          },
          limits: {
            spot: new BN(2),
            low: new BN(1),
            high: new BN(2),
          },
        },
        {
          prices: {
            low: new BN(1),
            high: new BN(2),
          },
          limits: {
            spot: new BN(2),
            low: new BN(1),
            high: new BN(2),
          },
        },
      ],
      mints: [DEFAULT_BUY_MINT.publicKey, DEFAULT_SELL_MINT.publicKey],
    },
    {
      desc: "Should fail if the rebalance limits are not all 0 or all greater than 0",
      expectedError: "InvalidRebalanceLimit",
      pricesAndLimits: [
        {
          prices: {
            low: new BN(0),
            high: new BN(0),
          },
          limits: {
            spot: new BN(2),
            low: new BN(1),
            high: new BN(0),
          },
        },
        {
          prices: {
            low: new BN(1),
            high: new BN(2),
          },
          limits: {
            spot: new BN(2),
            low: new BN(1),
            high: new BN(2),
          },
        },
      ],
      mints: [DEFAULT_BUY_MINT.publicKey, DEFAULT_SELL_MINT.publicKey],
    },
    {
      desc: "Should create rebalance and set all params",
      expectedError: null,
      allRebalanceDetailsAdded: true,
      pricesAndLimits: [
        {
          prices: {
            low: new BN(1),
            high: new BN(2),
          },
          limits: {
            spot: new BN(1),
            low: new BN(1),
            high: new BN(2),
          },
        },
        {
          prices: {
            low: new BN(1),
            high: new BN(2),
          },
          limits: {
            spot: new BN(2),
            low: new BN(1),
            high: new BN(2),
          },
        },
      ],
      mints: [DEFAULT_BUY_MINT.publicKey, DEFAULT_SELL_MINT.publicKey],
    },
    {
      desc: "Should clear old rebalance details",
      expectedError: null,
      allRebalanceDetailsAdded: false,
      existingRebalanceParams: {
        nonce: new BN(10),
        currentAuctionId: new BN(1),
        allRebalanceDetailsAdded: true,
        auctionLauncherWindow: 100,
        ttl: 100,
        startedAt: new BN(100),
        restrictedUntil: new BN(100),
        availableUntil: new BN(100),
      },
      pricesAndLimits: [
        {
          prices: {
            low: new BN(1),
            high: new BN(2),
          },
          limits: {
            spot: new BN(1),
            low: new BN(1),
            high: new BN(2),
          },
        },
        {
          prices: {
            low: new BN(1),
            high: new BN(2),
          },
          limits: {
            spot: new BN(2),
            low: new BN(1),
            high: new BN(2),
          },
        },
      ],
      mints: [DEFAULT_BUY_MINT.publicKey, DEFAULT_SELL_MINT.publicKey],
    },

    ...[
      ExtensionType.TransferFeeConfig,
      ExtensionType.MintCloseAuthority,
      ExtensionType.NonTransferable,
    ].map((extension) => {
      return {
        desc: `Should fail if ${ExtensionType[extension]} is present on mint`,
        expectedError: "UnsupportedSPLToken",
        allRebalanceDetailsAdded: true,
        addMintExtension: async (ctx: LiteSVM, buyMint: PublicKey) => {
          const accountLen = getMintLen([extension]);
          const existingAccount = await ctx.getAccount(buyMint);
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
          ctx.setAccount(buyMint, {
            ...existingAccount,
            data: finalData,
          });
        },
        existingRebalanceParams: {
          nonce: new BN(10),
          currentAuctionId: new BN(1),
          allRebalanceDetailsAdded: false,
          auctionLauncherWindow: 100,
          ttl: 100,
          startedAt: new BN(100),
          restrictedUntil: new BN(100),
          availableUntil: new BN(100),
        },
        pricesAndLimits: [
          {
            prices: {
              low: new BN(1),
              high: new BN(2),
            },
            limits: {
              spot: new BN(1),
              low: new BN(1),
              high: new BN(2),
            },
          },
          {
            prices: {
              low: new BN(1),
              high: new BN(2),
            },
            limits: {
              spot: new BN(2),
              low: new BN(1),
              high: new BN(2),
            },
          },
        ],
        mints: [BUY_MINTS_2022[0].publicKey, DEFAULT_SELL_MINT.publicKey],
      };
    }),

    ...[
      ExtensionType.Uninitialized,
      ExtensionType.InterestBearingConfig,
      ExtensionType.MetadataPointer,
      ExtensionType.TokenMetadata,
      ExtensionType.TokenGroup,
      ExtensionType.TokenGroupMember,
      ExtensionType.GroupPointer,
      ExtensionType.ConfidentialTransferMint,
      ExtensionType.DefaultAccountState,
      ExtensionType.PermanentDelegate,
      ExtensionType.TransferHook,
    ].map((extension) => {
      return {
        desc: `Should add rebalance details with ${ExtensionType[extension]}`,
        expectedError: null,
        allRebalanceDetailsAdded: true,
        addMintExtension: async (ctx: LiteSVM, buyMint: PublicKey) => {
          const accountLen = getMintLen(
            extension !== ExtensionType.TokenMetadata ? [extension] : [],
            extension === ExtensionType.TokenMetadata
              ? {
                  [ExtensionType.TokenMetadata]: 10,
                }
              : {}
          );
          const existingAccount = await ctx.getAccount(buyMint);
          const existingData = Buffer.from(existingAccount.data);
          const lengthRequired = accountLen - existingData.length;
          const additionalData = Buffer.alloc(lengthRequired);
          const startForExtensions = ACCOUNT_SIZE - existingData.length;
          additionalData.writeUInt8(AccountType.Mint, startForExtensions);
          let offset = startForExtensions + 1;
          additionalData.writeUInt16LE(extension, offset);
          offset += 2;
          additionalData.writeUInt16LE(
            extension === ExtensionType.TokenMetadata
              ? 10
              : getTypeLen(extension),
            offset
          );
          offset += 2;
          if (extension === ExtensionType.DefaultAccountState) {
            additionalData.writeUInt8(AccountState.Initialized, offset);
            offset += 1;
          }

          const finalData = Buffer.concat([existingData, additionalData]);
          ctx.setAccount(buyMint, {
            ...existingAccount,
            data: finalData,
          });
        },
        existingRebalanceParams: {
          nonce: new BN(10),
          currentAuctionId: new BN(1),
          allRebalanceDetailsAdded: false,
          auctionLauncherWindow: 100,
          ttl: 100,
          startedAt: new BN(100),
          restrictedUntil: new BN(100),
          availableUntil: new BN(100),
        },
        pricesAndLimits: [
          {
            prices: {
              low: new BN(1),
              high: new BN(2),
            },
            limits: {
              spot: new BN(1),
              low: new BN(1),
              high: new BN(2),
            },
          },
          {
            prices: {
              low: new BN(1),
              high: new BN(2),
            },
            limits: {
              spot: new BN(2),
              low: new BN(1),
              high: new BN(2),
            },
          },
        ],
        mints: [BUY_MINTS_2022[0].publicKey, DEFAULT_SELL_MINT.publicKey],
      };
    }),

    {
      desc: "Should add rebalance details with no mints",
      expectedError: null,
      existingRebalanceParams: {
        nonce: new BN(10),
        currentAuctionId: new BN(1),
        allRebalanceDetailsAdded: true,
        auctionLauncherWindow: 100,
        ttl: 100,
        startedAt: new BN(100),
        restrictedUntil: new BN(100),
        availableUntil: new BN(100),
      },
      allRebalanceDetailsAdded: false,
      pricesAndLimits: [],
      mints: [],
    },
  ];

  describe("Specific Cases - Start Rebalance", () => {
    TEST_CASE_START_REBALANCE.forEach(
      ({ desc, expectedError, ...restOfParams }) => {
        describe(`When ${desc}`, () => {
          let txnResult: BanksTransactionResultWithMeta;

          const {
            auctionLauncherWindow,
            ttl,
            pricesAndLimits,
            mints,
            allRebalanceDetailsAdded,
            existingRebalanceParams,
            addMintExtension,
          } = {
            ...DEFAULT_PARAMS,
            ...restOfParams,
          };

          let currentTime: BN;

          beforeEach(async () => {
            await initBaseCase();

            await travelFutureSlot(context);

            currentTime = new BN(
              (await context.getClock()).unixTimestamp.toString()
            );
            if (existingRebalanceParams) {
              await createAndSetRebalanceAccount(
                context,
                programFolio,
                folioPDA,
                existingRebalanceParams.allRebalanceDetailsAdded,
                existingRebalanceParams.currentAuctionId,
                existingRebalanceParams.nonce,
                existingRebalanceParams.startedAt,
                existingRebalanceParams.restrictedUntil,
                existingRebalanceParams.availableUntil
              );
            }
            await addMintExtension(context, mints[0]);
            txnResult = await startRebalance<true>(
              banksClient,
              programFolio,
              rebalanceManagerKeypair,
              folioPDA,
              folioTokenMint.publicKey,
              auctionLauncherWindow,
              ttl,
              pricesAndLimits,
              allRebalanceDetailsAdded,
              mints
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
              TestHelper.assertTime(rebalanceAfter.startedAt, currentTime);
              TestHelper.assertTime(
                rebalanceAfter.restrictedUntil,
                currentTime.add(new BN(auctionLauncherWindow))
              );
              TestHelper.assertTime(
                rebalanceAfter.availableUntil,
                currentTime.add(new BN(ttl))
              );

              assert.equal(rebalanceAfter.currentAuctionId.eq(new BN(0)), true);
              assert.equal(
                rebalanceAfter.nonce.eq(
                  existingRebalanceParams?.nonce.add(new BN(1)) || new BN(1)
                ),
                true
              );
              assert.equal(
                rebalanceAfter.allRebalanceDetailsAdded,
                allRebalanceDetailsAdded ? 1 : 0
              );

              if (mints.length > 0) {
                assert.equal(
                  rebalanceAfter.details.tokens[0].mint.equals(mints[0]),
                  true
                );
                assert.equal(
                  rebalanceAfter.details.tokens[1].mint.equals(mints[1]),
                  true
                );
                assert.equal(
                  rebalanceAfter.details.tokens[0].prices.low.eq(
                    pricesAndLimits[0].prices.low
                  ),
                  true
                );
                assert.equal(
                  rebalanceAfter.details.tokens[0].prices.high.eq(
                    pricesAndLimits[0].prices.high
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

  const TEST_CASE_ADD_REBALANCE_DETAILS = [
    {
      desc: "should fail if mints are provided but prices and limits are not",
      existingRebalanceParams: {
        nonce: new BN(10),
        currentAuctionId: new BN(1),
        allRebalanceDetailsAdded: false,
        auctionLauncherWindow: 100,
        ttl: 100,
        startedAt: new BN(100),
        restrictedUntil: new BN(100),
        availableUntil: new BN(100),
      },
      expectedError: "RebalanceMintsAndPricesAndLimitsLengthMismatch",
      mints: [DEFAULT_BUY_MINT.publicKey, DEFAULT_BUY_MINT.publicKey],
    },
    {
      desc: "Should fail is same mint is passed twice",
      expectedError: "RebalanceTokenAlreadyAdded",
      existingRebalanceParams: {
        nonce: new BN(10),
        currentAuctionId: new BN(1),
        allRebalanceDetailsAdded: false,
        auctionLauncherWindow: 100,
        ttl: 100,
        startedAt: new BN(100),
        restrictedUntil: new BN(100),
        availableUntil: new BN(100),
      },
      pricesAndLimits: [
        {
          prices: {
            low: new BN(1),
            high: new BN(2),
          },
          limits: {
            spot: new BN(2),
            low: new BN(1),
            high: new BN(2),
          },
        },
        {
          prices: {
            low: new BN(1),
            high: new BN(2),
          },
          limits: {
            spot: new BN(2),
            low: new BN(1),
            high: new BN(2),
          },
        },
      ],
      mints: [DEFAULT_BUY_MINT.publicKey, DEFAULT_BUY_MINT.publicKey],
    },
    {
      desc: "Should fail if the prices are deferred for the first token, adding price for the 2nd token should fail",
      expectedError: "InvalidPrices",
      existingRebalanceParams: {
        nonce: new BN(10),
        currentAuctionId: new BN(1),
        allRebalanceDetailsAdded: false,
        auctionLauncherWindow: 100,
        ttl: 100,
        startedAt: new BN(100),
        restrictedUntil: new BN(100),
        availableUntil: new BN(100),
      },
      pricesAndLimits: [
        {
          prices: {
            low: new BN(0),
            high: new BN(0),
          },
          limits: {
            spot: new BN(2),
            low: new BN(1),
            high: new BN(2),
          },
        },
        {
          prices: {
            low: new BN(1),
            high: new BN(2),
          },
          limits: {
            spot: new BN(2),
            low: new BN(1),
            high: new BN(2),
          },
        },
      ],
      mints: [DEFAULT_BUY_MINT.publicKey, DEFAULT_SELL_MINT.publicKey],
    },
    {
      desc: "Should fail if the rebalance limits are not all 0 or all greater than 0",
      expectedError: "InvalidRebalanceLimit",
      existingRebalanceParams: {
        nonce: new BN(10),
        currentAuctionId: new BN(1),
        allRebalanceDetailsAdded: false,
        auctionLauncherWindow: 100,
        ttl: 100,
        startedAt: new BN(100),
        restrictedUntil: new BN(100),
        availableUntil: new BN(100),
      },
      pricesAndLimits: [
        {
          prices: {
            low: new BN(0),
            high: new BN(0),
          },
          limits: {
            spot: new BN(2),
            low: new BN(1),
            high: new BN(0),
          },
        },
        {
          prices: {
            low: new BN(1),
            high: new BN(2),
          },
          limits: {
            spot: new BN(2),
            low: new BN(1),
            high: new BN(2),
          },
        },
      ],
      mints: [DEFAULT_BUY_MINT.publicKey, DEFAULT_SELL_MINT.publicKey],
    },
    {
      desc: "Should add rebalance details",
      expectedError: null,
      allRebalanceDetailsAdded: true,
      existingRebalanceParams: {
        nonce: new BN(10),
        currentAuctionId: new BN(1),
        allRebalanceDetailsAdded: false,
        auctionLauncherWindow: 100,
        ttl: 100,
        startedAt: new BN(100),
        restrictedUntil: new BN(100),
        availableUntil: new BN(100),
      },
      pricesAndLimits: [
        {
          prices: {
            low: new BN(1),
            high: new BN(2),
          },
          limits: {
            spot: new BN(1),
            low: new BN(1),
            high: new BN(2),
          },
        },
        {
          prices: {
            low: new BN(1),
            high: new BN(2),
          },
          limits: {
            spot: new BN(2),
            low: new BN(1),
            high: new BN(2),
          },
        },
      ],
      mints: [DEFAULT_BUY_MINT.publicKey, DEFAULT_SELL_MINT.publicKey],
    },
    {
      desc: "Should fail if rebalance is not open for detail updates",
      expectedError: "RebalanceNotOpenForDetailUpdates",
      allRebalanceDetailsAdded: false,
      existingRebalanceParams: {
        nonce: new BN(10),
        currentAuctionId: new BN(0),
        allRebalanceDetailsAdded: true,
        auctionLauncherWindow: 100,
        ttl: 100,
        startedAt: new BN(100),
        restrictedUntil: new BN(100),
        availableUntil: new BN(100),
      },
      pricesAndLimits: [
        {
          prices: {
            low: new BN(1),
            high: new BN(2),
          },
          limits: {
            spot: new BN(1),
            low: new BN(1),
            high: new BN(2),
          },
        },
        {
          prices: {
            low: new BN(1),
            high: new BN(2),
          },
          limits: {
            spot: new BN(2),
            low: new BN(1),
            high: new BN(2),
          },
        },
      ],
      mints: [DEFAULT_BUY_MINT.publicKey, DEFAULT_SELL_MINT.publicKey],
    },

    ...[
      ExtensionType.TransferFeeConfig,
      ExtensionType.MintCloseAuthority,
      ExtensionType.NonTransferable,
    ].map((extension) => {
      return {
        desc: `Should fail if ${ExtensionType[extension]} is present on mint`,
        expectedError: "UnsupportedSPLToken",
        allRebalanceDetailsAdded: true,
        addMintExtension: async (ctx: LiteSVM, buyMint: PublicKey) => {
          const accountLen = getMintLen([extension]);
          const existingAccount = await ctx.getAccount(buyMint);
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
          ctx.setAccount(buyMint, {
            ...existingAccount,
            data: finalData,
          });
        },
        existingRebalanceParams: {
          nonce: new BN(10),
          currentAuctionId: new BN(1),
          allRebalanceDetailsAdded: false,
          auctionLauncherWindow: 100,
          ttl: 100,
          startedAt: new BN(100),
          restrictedUntil: new BN(100),
          availableUntil: new BN(100),
        },
        pricesAndLimits: [
          {
            prices: {
              low: new BN(1),
              high: new BN(2),
            },
            limits: {
              spot: new BN(1),
              low: new BN(1),
              high: new BN(2),
            },
          },
          {
            prices: {
              low: new BN(1),
              high: new BN(2),
            },
            limits: {
              spot: new BN(2),
              low: new BN(1),
              high: new BN(2),
            },
          },
        ],
        mints: [BUY_MINTS_2022[0].publicKey, DEFAULT_SELL_MINT.publicKey],
      };
    }),

    ...[
      ExtensionType.Uninitialized,
      ExtensionType.InterestBearingConfig,
      ExtensionType.MetadataPointer,
      ExtensionType.TokenMetadata,
      ExtensionType.TokenGroup,
      ExtensionType.TokenGroupMember,
      ExtensionType.GroupPointer,
      ExtensionType.ConfidentialTransferMint,
      ExtensionType.DefaultAccountState,
      ExtensionType.PermanentDelegate,
      ExtensionType.TransferHook,
    ].map((extension) => {
      return {
        desc: `Should add rebalance details with ${ExtensionType[extension]}`,
        expectedError: null,
        allRebalanceDetailsAdded: true,
        addMintExtension: async (ctx: LiteSVM, buyMint: PublicKey) => {
          const accountLen = getMintLen(
            extension !== ExtensionType.TokenMetadata ? [extension] : [],
            extension === ExtensionType.TokenMetadata
              ? {
                  [ExtensionType.TokenMetadata]: 10,
                }
              : {}
          );
          const existingAccount = await ctx.getAccount(buyMint);
          const existingData = Buffer.from(existingAccount.data);
          const lengthRequired = accountLen - existingData.length;
          const additionalData = Buffer.alloc(lengthRequired);
          const startForExtensions = ACCOUNT_SIZE - existingData.length;
          additionalData.writeUInt8(AccountType.Mint, startForExtensions);
          let offset = startForExtensions + 1;
          additionalData.writeUInt16LE(extension, offset);
          offset += 2;
          additionalData.writeUInt16LE(
            extension === ExtensionType.TokenMetadata
              ? 10
              : getTypeLen(extension),
            offset
          );
          offset += 2;
          if (extension === ExtensionType.DefaultAccountState) {
            additionalData.writeUInt8(AccountState.Initialized, offset);
            offset += 1;
          }

          const finalData = Buffer.concat([existingData, additionalData]);
          ctx.setAccount(buyMint, {
            ...existingAccount,
            data: finalData,
          });
        },
        existingRebalanceParams: {
          nonce: new BN(10),
          currentAuctionId: new BN(1),
          allRebalanceDetailsAdded: false,
          auctionLauncherWindow: 100,
          ttl: 100,
          startedAt: new BN(100),
          restrictedUntil: new BN(100),
          availableUntil: new BN(100),
        },
        pricesAndLimits: [
          {
            prices: {
              low: new BN(1),
              high: new BN(2),
            },
            limits: {
              spot: new BN(1),
              low: new BN(1),
              high: new BN(2),
            },
          },
          {
            prices: {
              low: new BN(1),
              high: new BN(2),
            },
            limits: {
              spot: new BN(2),
              low: new BN(1),
              high: new BN(2),
            },
          },
        ],
        mints: [BUY_MINTS_2022[0].publicKey, DEFAULT_SELL_MINT.publicKey],
      };
    }),
  ];

  describe("Specific Cases - Add Rebalance Details", () => {
    TEST_CASE_ADD_REBALANCE_DETAILS.forEach(
      ({ desc, expectedError, ...restOfParams }) => {
        let rebalanceBefore: any;
        describe(`When ${desc}`, () => {
          let txnResult: BanksTransactionResultWithMeta;

          const {
            pricesAndLimits,
            mints,
            allRebalanceDetailsAdded,
            existingRebalanceParams,
            addMintExtension,
          } = {
            ...DEFAULT_PARAMS,
            ...restOfParams,
          };

          beforeEach(async () => {
            await initBaseCase();

            await travelFutureSlot(context);

            await createAndSetRebalanceAccount(
              context,
              programFolio,
              folioPDA,
              existingRebalanceParams.allRebalanceDetailsAdded,
              existingRebalanceParams.currentAuctionId,
              existingRebalanceParams.nonce,
              existingRebalanceParams.startedAt,
              existingRebalanceParams.restrictedUntil,
              existingRebalanceParams.availableUntil
            );

            rebalanceBefore = await programFolio.account.rebalance.fetch(
              getRebalancePDA(folioPDA)
            );
            await addMintExtension(context, mints[0]);
            txnResult = await addRebalanceDetails<true>(
              banksClient,
              programFolio,
              rebalanceManagerKeypair,
              folioPDA,
              pricesAndLimits,
              allRebalanceDetailsAdded,
              mints
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
              TestHelper.assertTime(
                rebalanceAfter.startedAt,
                rebalanceBefore.startedAt
              );
              TestHelper.assertTime(
                rebalanceAfter.restrictedUntil,
                rebalanceBefore.restrictedUntil
              );
              TestHelper.assertTime(
                rebalanceAfter.availableUntil,
                rebalanceBefore.availableUntil
              );

              assert.equal(
                rebalanceAfter.currentAuctionId.eq(
                  existingRebalanceParams.currentAuctionId
                ),
                true
              );
              assert.equal(
                rebalanceAfter.nonce.eq(existingRebalanceParams.nonce),
                true
              );
              assert.equal(
                rebalanceAfter.allRebalanceDetailsAdded,
                allRebalanceDetailsAdded ? 1 : 0
              );

              assert.equal(
                rebalanceAfter.details.tokens[0].mint.equals(mints[0]),
                true
              );
              assert.equal(
                rebalanceAfter.details.tokens[1].mint.equals(mints[1]),
                true
              );
              assert.equal(
                rebalanceAfter.details.tokens[0].prices.low.eq(
                  pricesAndLimits[0].prices.low
                ),
                true
              );
              assert.equal(
                rebalanceAfter.details.tokens[0].prices.high.eq(
                  pricesAndLimits[0].prices.high
                ),
                true
              );
            });
          }
        });
      }
    );
  });
});
