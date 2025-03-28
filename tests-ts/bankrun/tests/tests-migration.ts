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

import { getFolioPDA, getProgramRegistrarPDA } from "../../../utils/pda-helper";
import {
  crankFeeDistribution,
  migrateFolioTokens,
  startFolioMigration,
} from "../bankrun-ix-helper";
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
  DEFAULT_DECIMALS,
  FOLIO_PROGRAM_ID,
  MAX_MINT_FEE,
  TOTAL_PORTION_FEE_RECIPIENT,
} from "../../../utils/constants";
import {
  assertExpectedBalancesChanges,
  getMintAuthorities,
  getOrCreateAtaAddress,
  getTokenBalance,
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

  const MINTS = [Keypair.generate(), Keypair.generate()];

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
      desc: "(new folio not owned by new folio program, errors out)",
      expectedError: "NewFolioNotOwnedByNewFolioProgram",
      secondFolioOwner: Keypair.generate().publicKey,
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

  const TEST_CASES_CRANK_FEE_DISTRIBUTION_VIA_NEW_FOLIO_PROGRAM = [
    {
      desc: "(new folio is not mint authority of folio token mint, errors out)",
      expectedError: "InvalidFolioTokenMint",
      isMigrating: true,
      mintAuthority: Keypair.generate().publicKey,
    },
    {
      desc: "(new folio program not in program registrar, errors out)",
      expectedError: "ProgramNotInRegistrar",
      includeSecondProgramInRegistrar: false,
      isMigrating: true,
    },
    {
      desc: "(new folio not owned by new folio program, errors out)",
      expectedError: "NewFolioNotOwnedByNewFolioProgram",
      isMigrating: true,
      secondFolioOwner: Keypair.generate().publicKey,
    },
    {
      desc: "(is valid, succeeds)",
      expectedError: null,
      isMigrating: true,
    },
  ];

  async function initBaseCase(
    customFolioTokenMint: Keypair = null,
    secondFolioOwner: PublicKey = null,
    initialFolioBasket: FolioTokenAmount[] = [],
    // When second step of migration, we expect some changes to already be done
    isMigrating: boolean = false,
    includeSecondProgramInRegistrar: boolean = true,
    mintAuthority: PublicKey = null,
    amountToDistribute: BN = new BN(0)
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
      new BN(0),
      new BN(0),
      new BN(0),
      false,
      [],
      [],
      "",
      amountToDistribute
    );

    await createAndSetFolioBasket(
      context,
      programFolio,
      oldFolioPDA,
      initialFolioBasket
    );

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

    // Change the owner of the second folio if required
    if (secondFolioOwner) {
      const secondFolioAccount = await banksClient.getAccount(newFolioPDA);
      context.setAccount(newFolioPDA, {
        ...secondFolioAccount,
        owner: secondFolioOwner,
      });
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
      adminKeypair.publicKey,
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

    await initBaseCase();
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
        feeRecipient,
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

    const generalIxCrankFeeDistributionViaNewFolioProgram = () =>
      crankFeeDistribution<true>(
        banksClient,
        programFolio,
        userKeypair,
        oldFolioPDA,
        folioTokenMint.publicKey,
        adminKeypair.publicKey,
        new BN(0),
        [],
        [],
        true,
        [],
        newFolioPDA,
        programFolioSecond.programId,
        getProgramRegistrarPDA()
      );

    beforeEach(async () => {
      await initBaseCase();
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

    describe("should run general tests for crank fee distribution via new folio program", () => {
      beforeEach(async () => {
        // Mint is given to the new folio
        initToken(context, newFolioPDA, folioTokenMint, DEFAULT_DECIMALS);
      });

      it(`should run ${GeneralTestCases.InvalidFolioStatus} for INITIALIZED & KILLED & INITIALIZING`, async () => {
        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,
          generalIxCrankFeeDistributionViaNewFolioProgram,
          FolioStatus.Initialized
        );

        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,
          generalIxCrankFeeDistributionViaNewFolioProgram,
          FolioStatus.Killed
        );

        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,
          generalIxCrankFeeDistributionViaNewFolioProgram,
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
          const { secondFolioOwner, newFolioProgram, customFolioTokenMint } = {
            ...DEFAULT_PARAMS,
            ...restOfParams,
          };

          let mintAuthoritiesBefore: any;

          before(async () => {
            await initBaseCase(customFolioTokenMint, secondFolioOwner);

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
              new BN(1),
              feeRecipient,
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

              await assertExpectedBalancesChanges(
                context,
                beforeBalances,
                tokens,
                [oldFolioPDA, newFolioPDA],
                expectedTokenBalanceChanges
              );
            });
          }
        });
      }
    );
  });

  describe("Specific Cases - Crank fee distribution via new folio program", () => {
    TEST_CASES_CRANK_FEE_DISTRIBUTION_VIA_NEW_FOLIO_PROGRAM.forEach(
      ({ desc, expectedError, ...restOfParams }) => {
        describe(`When ${desc}`, () => {
          let txnResult: BanksTransactionResultWithMeta;
          const {
            secondFolioOwner,
            newFolioProgram,
            isMigrating,
            includeSecondProgramInRegistrar,
            mintAuthority,
          } = {
            ...DEFAULT_PARAMS,
            ...restOfParams,
          };

          let feeRecipientATA: PublicKey;
          let balanceBefore: bigint;

          before(async () => {
            await initBaseCase(
              undefined,
              secondFolioOwner,
              [],
              isMigrating,
              includeSecondProgramInRegistrar,
              mintAuthority,
              AMOUNT_TO_DISTRIBUTE
            );

            if (newFolioProgram) {
              context.setAccount(newFolioProgram, {
                lamports: 1_000_000_000,
                data: Buffer.alloc(100),
                owner: BPF_PROGRAM_USED_BY_BANKRUN,
                executable: true,
              });
            }

            await travelFutureSlot(context);

            feeRecipientATA = await getOrCreateAtaAddress(
              context,
              folioTokenMint.publicKey,
              feeRecipients[0].publicKey
            );

            balanceBefore = await getTokenBalance(banksClient, feeRecipientATA);

            txnResult = await crankFeeDistribution<true>(
              banksClient,
              programFolio,
              userKeypair,
              oldFolioPDA,
              folioTokenMint.publicKey,
              adminKeypair.publicKey,
              new BN(0),
              [new BN(0)],
              [feeRecipientATA],
              true,
              [],
              newFolioPDA,
              newFolioProgram || programFolioSecond.programId,
              getProgramRegistrarPDA()
            );
          });

          if (expectedError) {
            it("should fail with expected error", () => {
              assertError(txnResult, expectedError);
            });
          } else {
            it("should succeed", async () => {
              await travelFutureSlot(context);

              const balanceAfter = await getTokenBalance(
                banksClient,
                feeRecipientATA
              );

              assert.equal(
                balanceAfter.toString(),
                (
                  balanceBefore +
                  BigInt(AMOUNT_TO_DISTRIBUTE.div(D9).toString())
                ).toString()
              );
            });
          }
        });
      }
    );
  });
});
