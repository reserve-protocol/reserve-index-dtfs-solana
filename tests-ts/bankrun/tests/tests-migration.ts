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

import { getFolioBasketPDA, getFolioPDA } from "../../../utils/pda-helper";
import { migrateFolioTokens, startFolioMigration } from "../bankrun-ix-helper";
import {
  createAndSetFolio,
  Role,
  createAndSetActor,
  FolioStatus,
  createAndSetProgramRegistrar,
  createAndSetFolioBasket,
  createAndSetDaoFeeConfig,
  createAndSetFeeRecipients,
  createAndSetFeeDistribution,
  FolioTokenAmount,
  createAndSetMetadataAccount,
} from "../bankrun-account-helper";
import { Folio } from "../../../target/types/folio";
import {
  assertInvalidFolioStatusTestCase,
  assertNotValidRoleTestCase,
  GeneralTestCases,
} from "../bankrun-general-tests-helper";
import * as assert from "assert";

import {
  BPF_PROGRAM_USED_BY_BANKRUN,
  D9,
  DAY_IN_SECONDS,
  DEFAULT_DECIMALS,
  FOLIO_PROGRAM_ID,
  MAX_MINT_FEE,
  TOTAL_PORTION_FEE_RECIPIENT,
} from "../../../utils/constants";
import {
  assertExpectedBalancesChanges,
  getMintAuthorities,
  getOrCreateAtaAddress,
  getTokenBalancesFromMints,
  initToken,
  mintToken,
} from "../bankrun-token-helper";
import { FolioAdmin } from "../../../target/types/folio_admin";
import { Folio as FolioSecond } from "../../../target/types/second_folio";

/**
 * Tests for folio migration functionality, including:
 * - Starting migration process
 * - Migrating folio tokens
 * - Program validation
 * - Token transfer validation
 * - Account state updates during migration
 */

describe("Bankrun - Folio migration", () => {
  let context: ProgramTestContext;
  let provider: BankrunProvider;
  let banksClient: BanksClient;

  let programFolio: Program<Folio>;
  let programFolioSecond: Program<FolioSecond>;
  let programFolioAdmin: Program<FolioAdmin>;
  let keys: any;

  let payerKeypair: Keypair;
  let adminKeypair: Keypair;

  let folioOwnerKeypair: Keypair;
  let folioTokenMint: Keypair;

  let oldFolioPDA: PublicKey;
  let newFolioPDA: PublicKey;

  const feeRecipient: PublicKey = Keypair.generate().publicKey;

  const MINTS = [Keypair.generate(), Keypair.generate(), Keypair.generate()];

  let userKeypair: Keypair;
  const feeRecipients: Keypair[] = [Keypair.generate()];

  const AMOUNT_TO_DISTRIBUTE = new BN(100_000_000).mul(D9);

  const DEFAULT_PARAMS: {
    tokens: PublicKey[];
    remainingAccounts: () => Promise<AccountMeta[]>;

    customFolioTokenMint: Keypair;
    newFolioProgram: PublicKey;

    secondFolioOwner: PublicKey;

    initialFolioBasket: FolioTokenAmount[];

    isMigrating: boolean;

    includeSecondProgramInRegistrar: boolean;

    mintAuthority: PublicKey;

    // Expected changes
    expectedTokenBalanceChanges: BN[];

    maxAllowedPendingFees: BN;
    folioConfig: {
      lastPoke: BN | null;
      daoPendingFeeShares: BN | null;
      feeRecipientsPendingFeeShares: BN | null;
      feeRecipientsPendingFeeSharesToBeMinted: BN | null;
    } | null;
  } = {
    tokens: [],
    remainingAccounts: async () => [],

    customFolioTokenMint: null,
    newFolioProgram: null,

    secondFolioOwner: null,

    initialFolioBasket: [],

    isMigrating: false,

    includeSecondProgramInRegistrar: true,

    mintAuthority: null,

    // Expected changes
    expectedTokenBalanceChanges: Array(MINTS.length).fill(new BN(0)),

    maxAllowedPendingFees: new BN(D9),

    folioConfig: null,
  };

  const TEST_CASES_START_MIGRATION = [
    {
      desc: "(folio token mint is not valid)",
      expectedError: "InvalidFolioTokenMint",
      customFolioTokenMint: Keypair.generate(),
    },
    {
      desc: "(new folio program not in program registrar, errors out)",
      expectedError: "ProgramNotInRegistrar",
      newFolioProgram: Keypair.generate().publicKey,
    },
    {
      desc: "(new folio program same as old folio program, errors out)",
      expectedError: "CantMigrateToSameProgram",
      secondFolioOwner: FOLIO_PROGRAM_ID,
      newFolioProgram: FOLIO_PROGRAM_ID,
    },
    {
      desc: "(is valid, succeeds)",
      expectedError: null,
    },
  ];

  const TEST_CASES_MIGRATE_FOLIO_TOKENS = [
    {
      desc: "(folio token mint is not valid)",
      expectedError: "InvalidFolioTokenMint",
      customFolioTokenMint: Keypair.generate(),
    },
    {
      desc: "(new folio program not in program registrar, errors out)",
      expectedError: "ProgramNotInRegistrar",
      newFolioProgram: Keypair.generate().publicKey,
    },
    {
      desc: "(new folio not owned by new folio program, errors out)",
      expectedError: "NewFolioNotOwnedByNewFolioProgram",
      secondFolioOwner: Keypair.generate().publicKey,
    },
    {
      desc: "(invalid number of remaining accounts, errors out)",
      expectedError: "InvalidNumberOfRemainingAccounts",
      remainingAccounts: async () => [
        {
          pubkey: Keypair.generate().publicKey,
          isWritable: true,
          isSigner: false,
        },
      ],
    },
    {
      desc: "(invalid sender token account, errors out)",
      expectedError: "InvalidSenderTokenAccount",
      remainingAccounts: async () => [
        {
          pubkey: MINTS[0].publicKey,
          isWritable: false,
          isSigner: false,
        },
        {
          pubkey: await getOrCreateAtaAddress(
            context,
            MINTS[0].publicKey,
            newFolioPDA
          ),
          isWritable: true,
          isSigner: false,
        },
        {
          pubkey: await getOrCreateAtaAddress(
            context,
            MINTS[1].publicKey,
            newFolioPDA
          ),
          isWritable: true,
          isSigner: false,
        },
      ],
    },
    {
      desc: "(invalid recipient token account, errors out)",
      expectedError: "InvalidRecipientTokenAccount",
      remainingAccounts: async () => [
        {
          pubkey: MINTS[0].publicKey,
          isWritable: false,
          isSigner: false,
        },
        {
          pubkey: await getOrCreateAtaAddress(
            context,
            MINTS[0].publicKey,
            oldFolioPDA
          ),
          isWritable: true,
          isSigner: false,
        },
        {
          pubkey: await getOrCreateAtaAddress(
            context,
            MINTS[1].publicKey,
            oldFolioPDA
          ),
          isWritable: true,
          isSigner: false,
        },
      ],
    },
    {
      desc: "(migrate balance, has some pending redeeming and minting basket, valid)",
      expectedError: null,
      initialFolioBasket: [
        new FolioTokenAmount(MINTS[0].publicKey, new BN(100).mul(D9)),
        new FolioTokenAmount(MINTS[1].publicKey, new BN(200).mul(D9)),
        new FolioTokenAmount(MINTS[2].publicKey, new BN(200).mul(D9)),
      ],
      tokens: [MINTS[0].publicKey, MINTS[1].publicKey],
      // Folio has 1000 in D9 total of each (negative as the old folio is losing them)
      expectedTokenBalanceChanges: [
        new BN(100).mul(D9).neg(),
        new BN(200).mul(D9).neg(),
        new BN(100).mul(D9),
        new BN(200).mul(D9),
      ],
    },
    {
      desc: "(migrate balance, has no pending redeeming and minting basket, valid)",
      expectedError: null,
      initialFolioBasket: [
        new FolioTokenAmount(MINTS[0].publicKey, new BN(1000).mul(D9)),
        new FolioTokenAmount(MINTS[1].publicKey, new BN(1000).mul(D9)),
      ],
      tokens: [MINTS[0].publicKey, MINTS[1].publicKey],
      // Folio has 1000 in D9 total of each (negative as the old folio is losing them)
      expectedTokenBalanceChanges: [
        new BN(1000).mul(D9).neg(),
        new BN(1000).mul(D9).neg(),
        new BN(1000).mul(D9),
        new BN(1000).mul(D9),
      ],
    },
  ];

  async function initBaseCase(
    isBaseCaseForMigrateFolioTokens: boolean = false,
    folioConfig: {
      lastPoke: BN | null;
      daoPendingFeeShares: BN | null;
      feeRecipientsPendingFeeShares: BN | null;
      feeRecipientsPendingFeeSharesToBeMinted: BN | null;
    } | null = null,
    customFolioTokenMint: Keypair = null,
    secondFolioOwner: PublicKey = null,
    initialFolioBasket: FolioTokenAmount[] = [],
    // When second step of migration, we expect some changes to already be done
    isMigrating: boolean = false,
    includeSecondProgramInRegistrar: boolean = true,
    mintAuthority: PublicKey = null
  ) {
    await createAndSetDaoFeeConfig(
      context,
      programFolioAdmin,
      feeRecipient,
      new BN(0),
      new BN(0)
    );

    const folioTokenMintToUse = customFolioTokenMint || folioTokenMint;
    oldFolioPDA = getFolioPDA(folioTokenMintToUse.publicKey);

    await createAndSetFolio(
      context,
      programFolio,
      folioTokenMintToUse.publicKey,
      isMigrating ? FolioStatus.Migrating : FolioStatus.Initialized,
      null,
      folioConfig?.lastPoke ?? new BN(0),
      folioConfig?.daoPendingFeeShares ?? new BN(0),
      folioConfig?.feeRecipientsPendingFeeShares ?? new BN(0),
      false,
      "",
      folioConfig?.feeRecipientsPendingFeeSharesToBeMinted ?? new BN(0)
    );

    await createAndSetFolioBasket(
      context,
      programFolio,
      oldFolioPDA,
      initialFolioBasket
    );

    await createAndSetMetadataAccount(
      context,
      oldFolioPDA,
      folioTokenMint.publicKey
    );

    if (isBaseCaseForMigrateFolioTokens) {
      // Folio in second program
      await createAndSetFolio(
        context,
        programFolioSecond,
        folioTokenMint.publicKey,
        FolioStatus.Initialized,
        null,
        new BN(0),
        new BN(0),
        new BN(0),
        true
      );

      // Create empty folio basket
      await createAndSetFolioBasket(
        context,
        programFolioSecond,
        newFolioPDA,
        []
      );

      // Change the owner of the second folio if required
      if (secondFolioOwner !== null) {
        const secondFolioAccount = await banksClient.getAccount(newFolioPDA);
        context.setAccount(newFolioPDA, {
          ...secondFolioAccount,
          owner: secondFolioOwner,
        });
      }
    }

    initToken(
      context,
      mintAuthority ?? (isMigrating ? newFolioPDA : oldFolioPDA),
      folioTokenMint,
      DEFAULT_DECIMALS
    );

    for (const mint of MINTS) {
      initToken(context, adminKeypair.publicKey, mint, DEFAULT_DECIMALS);

      mintToken(context, mint.publicKey, 1_000, oldFolioPDA);
    }

    await createAndSetActor(
      context,
      programFolio,
      folioOwnerKeypair,
      oldFolioPDA,
      Role.Owner
    );

    await createAndSetProgramRegistrar(context, programFolioAdmin, [
      programFolio.programId,
      ...(includeSecondProgramInRegistrar
        ? [programFolioSecond.programId]
        : []),
    ]);

    // For crank fee distribution via new folio program
    await createAndSetDaoFeeConfig(
      context,
      programFolioAdmin,
      feeRecipient,
      MAX_MINT_FEE
    );

    await createAndSetFeeRecipients(context, programFolio, oldFolioPDA, []);

    await createAndSetFeeDistribution(
      context,
      programFolio,
      oldFolioPDA,
      adminKeypair.publicKey,
      new BN(0),
      AMOUNT_TO_DISTRIBUTE,
      [
        {
          recipient: feeRecipients[0].publicKey,
          portion: TOTAL_PORTION_FEE_RECIPIENT,
        },
      ]
    );
  }

  before(async () => {
    ({
      keys,
      programFolio,
      programFolioSecond,
      programFolioAdmin,
      provider,
      context,
    } = await getConnectors());

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

    oldFolioPDA = getFolioPDA(folioTokenMint.publicKey);
    newFolioPDA = getFolioPDA(folioTokenMint.publicKey, true);

    await initBaseCase(false);
  });

  describe("General Tests", () => {
    const generalIxStartMigration = () =>
      startFolioMigration<true>(
        context,
        banksClient,
        programFolio,
        folioOwnerKeypair,
        folioTokenMint.publicKey,
        oldFolioPDA,
        newFolioPDA,
        programFolioSecond.programId,
        new BN(1),
        true
      );

    const generalIxMigrateFolioTokens = () =>
      migrateFolioTokens<true>(
        context,
        banksClient,
        programFolio,
        folioOwnerKeypair,
        oldFolioPDA,
        newFolioPDA,
        programFolioSecond.programId,
        folioTokenMint.publicKey,
        [],
        true
      );

    beforeEach(async () => {
      await initBaseCase(false);
    });

    describe("should run general tests for start folio migration", () => {
      it(`should run ${GeneralTestCases.NotRole}`, async () => {
        await assertNotValidRoleTestCase(
          context,
          programFolio,
          folioOwnerKeypair,
          oldFolioPDA,
          generalIxStartMigration
        );
      });

      it(`should run ${GeneralTestCases.InvalidFolioStatus} for MIGRATING & INITIALIZING`, async () => {
        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,
          generalIxStartMigration,
          FolioStatus.Migrating
        );

        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,
          generalIxStartMigration,
          FolioStatus.Initializing
        );
      });
    });

    describe("should run general tests for migrate folio tokens", () => {
      beforeEach(async () => {
        // Mint is given to the new folio
        initToken(context, newFolioPDA, folioTokenMint, DEFAULT_DECIMALS);
      });

      it(`should run ${GeneralTestCases.InvalidFolioStatus} for INITIALIZED & INITIALIZING & KILLED`, async () => {
        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,
          generalIxMigrateFolioTokens,
          FolioStatus.Initialized
        );

        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,
          generalIxMigrateFolioTokens,
          FolioStatus.Killed
        );

        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,
          generalIxMigrateFolioTokens,
          FolioStatus.Initializing
        );
      });
    });
  });

  describe("Specific Cases - Start Folio Migration", () => {
    TEST_CASES_START_MIGRATION.forEach(
      ({ desc, expectedError, ...restOfParams }) => {
        describe(`When ${desc}`, () => {
          let txnResult: BanksTransactionResultWithMeta;
          const {
            newFolioProgram,
            customFolioTokenMint,
            maxAllowedPendingFees,
            folioConfig,
          } = {
            ...DEFAULT_PARAMS,
            ...restOfParams,
          };

          let mintAuthoritiesBefore: any;

          before(async () => {
            let folioConfigToUse = folioConfig;
            if (folioConfig?.lastPoke == null) {
              const currentTime = BigInt(
                (await context.banksClient.getClock()).unixTimestamp.toString()
              );
              const endOfDay =
                (currentTime / BigInt(DAY_IN_SECONDS)) * BigInt(DAY_IN_SECONDS);
              folioConfigToUse = {
                ...folioConfig,
                lastPoke: new BN(endOfDay.toString()),
              };
            }

            await initBaseCase(false, folioConfigToUse, customFolioTokenMint);
            if (newFolioProgram) {
              context.setAccount(newFolioProgram, {
                lamports: 1_000_000_000,
                data: Buffer.alloc(100),
                owner: BPF_PROGRAM_USED_BY_BANKRUN,
                executable: true,
              });
            }

            mintAuthoritiesBefore = await getMintAuthorities(
              banksClient,
              folioTokenMint.publicKey
            );

            await travelFutureSlot(context);

            txnResult = await startFolioMigration<true>(
              context,
              banksClient,
              programFolio,
              folioOwnerKeypair,
              folioTokenMint.publicKey,
              oldFolioPDA,
              newFolioPDA,
              newFolioProgram || programFolioSecond.programId,
              maxAllowedPendingFees,
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

              const mintAuthoritiesAfter = await getMintAuthorities(
                banksClient,
                folioTokenMint.publicKey
              );

              assert.deepEqual(
                mintAuthoritiesBefore.mintAuthority,
                oldFolioPDA
              );
              assert.deepEqual(
                mintAuthoritiesBefore.freezeAuthority,
                oldFolioPDA
              );
              assert.deepEqual(mintAuthoritiesAfter.mintAuthority, newFolioPDA);
              assert.deepEqual(
                mintAuthoritiesAfter.freezeAuthority,
                newFolioPDA
              );
            });
          }
        });
      }
    );
  });

  describe("Specific Cases - Migrate Folio Tokens", () => {
    TEST_CASES_MIGRATE_FOLIO_TOKENS.forEach(
      ({ desc, expectedError, ...restOfParams }) => {
        describe(`When ${desc}`, () => {
          let txnResult: BanksTransactionResultWithMeta;
          const {
            secondFolioOwner,
            newFolioProgram,
            customFolioTokenMint,
            tokens,
            remainingAccounts,
            expectedTokenBalanceChanges,
            initialFolioBasket,
          } = {
            ...DEFAULT_PARAMS,
            ...restOfParams,
          };

          let beforeBalances: {
            owner: PublicKey;
            balances: bigint[];
          }[] = [];

          before(async () => {
            await initBaseCase(
              true,
              null,
              customFolioTokenMint,
              secondFolioOwner,
              initialFolioBasket,
              true
            );

            if (newFolioProgram) {
              context.setAccount(newFolioProgram, {
                lamports: 1_000_000_000,
                data: Buffer.alloc(100),
                owner: BPF_PROGRAM_USED_BY_BANKRUN,
                executable: true,
              });
            }

            beforeBalances = await getTokenBalancesFromMints(context, tokens, [
              oldFolioPDA,
              newFolioPDA,
            ]);

            await travelFutureSlot(context);

            txnResult = await migrateFolioTokens<true>(
              context,
              banksClient,
              programFolio,
              payerKeypair, // Can be anyone
              oldFolioPDA,
              newFolioPDA,
              newFolioProgram || programFolioSecond.programId,
              folioTokenMint.publicKey,
              tokens,
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

              const newFolioBasketPDA = await getFolioBasketPDA(
                newFolioPDA,
                programFolioSecond.programId
              );

              const newFolioBasket =
                await programFolio.account.folioBasket.fetch(newFolioBasketPDA);

              for (const tokenAmount of newFolioBasket.basket.tokenAmounts) {
                if (tokenAmount.mint.equals(PublicKey.default)) {
                  assert.equal(tokenAmount.amount.eq(new BN(0)), true);
                  continue;
                }

                const tokenInInitialBasket = initialFolioBasket.find((t) =>
                  t.mint.equals(tokenAmount.mint)
                );

                if (tokenInInitialBasket) {
                  assert.equal(
                    tokenAmount.amount.eq(tokenInInitialBasket.amount),
                    true
                  );
                } else {
                  assert.fail(
                    `Token ${tokenAmount.mint.toBase58()} not found in initial basket`
                  );
                }
              }

              await assertExpectedBalancesChanges(
                context,
                beforeBalances,
                tokens,
                [oldFolioPDA, newFolioPDA],
                expectedTokenBalanceChanges
              );

              const oldFolioBasketPDA = await getFolioBasketPDA(
                oldFolioPDA,
                programFolio.programId
              );

              const oldFolioBasket =
                await programFolio.account.folioBasket.fetch(oldFolioBasketPDA);
              const hasAnyTokenLeft = oldFolioBasket.basket.tokenAmounts.some(
                (t) => !t.mint.equals(PublicKey.default)
              );

              const newFolio = await programFolio.account.folio.fetch(
                newFolioPDA
              );
              assert.equal(
                newFolio.status,
                hasAnyTokenLeft
                  ? FolioStatus.Migrating
                  : FolioStatus.Initialized
              );

              const oldFolio = await programFolio.account.folio.fetch(
                oldFolioPDA
              );
              // The status will stay Migrating forever.
              assert.equal(oldFolio.status, FolioStatus.Migrating);
            });
          }
        });
      }
    );
  });
});
