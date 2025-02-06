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

import { getFolioPDA } from "../../../utils/pda-helper";
import { migrateFolioTokens, startFolioMigration } from "../bankrun-ix-helper";
import {
  createAndSetFolio,
  Role,
  createAndSetActor,
  FolioStatus,
  createAndSetProgramRegistrar,
  createAndSetFolioBasket,
  TokenAmount,
} from "../bankrun-account-helper";
import { Folio } from "../../../target/types/folio";
import {
  assertInvalidFolioStatusTestCase,
  assertNotOwnerTestCase,
  GeneralTestCases,
} from "../bankrun-general-tests-helper";
import * as assert from "assert";

import {
  BPF_PROGRAM_USED_BY_BANKRUN,
  DEFAULT_DECIMALS,
  FOLIO_PROGRAM_ID,
} from "../../../utils/constants";
import {
  assertExpectedBalancesChanges,
  getAtaAddress,
  getMintAuthorities,
  getTokenBalancesFromMints,
  initToken,
  mintToken,
} from "../bankrun-token-helper";
import { FolioAdmin } from "../../../target/types/folio_admin";
import { Folio as FolioSecond } from "../../../target/types/second_folio";
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

  const MINTS = [Keypair.generate(), Keypair.generate()];

  const DEFAULT_PARAMS: {
    tokens: PublicKey[];
    remainingAccounts: () => AccountMeta[];

    customFolioTokenMint: Keypair;
    newFolioProgram: PublicKey;

    secondFolioOwner: PublicKey;

    initialFolioBasket: TokenAmount[];

    // Expected changes
    expectedTokenBalanceChanges: BN[];
  } = {
    tokens: [],
    remainingAccounts: () => [],

    customFolioTokenMint: null,
    newFolioProgram: null,

    secondFolioOwner: null,

    initialFolioBasket: [],

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
      remainingAccounts: () => [
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
      remainingAccounts: () => [
        {
          pubkey: MINTS[0].publicKey,
          isWritable: false,
          isSigner: false,
        },
        {
          pubkey: getAtaAddress(MINTS[0].publicKey, newFolioPDA),
          isWritable: true,
          isSigner: false,
        },
        {
          pubkey: getAtaAddress(MINTS[1].publicKey, newFolioPDA),
          isWritable: true,
          isSigner: false,
        },
      ],
    },
    {
      desc: "(invalid receiver token account, errors out)",
      expectedError: "InvalidReceiverTokenAccount",
      remainingAccounts: () => [
        {
          pubkey: MINTS[0].publicKey,
          isWritable: false,
          isSigner: false,
        },
        {
          pubkey: getAtaAddress(MINTS[0].publicKey, oldFolioPDA),
          isWritable: true,
          isSigner: false,
        },
        {
          pubkey: getAtaAddress(MINTS[1].publicKey, oldFolioPDA),
          isWritable: true,
          isSigner: false,
        },
      ],
    },
    {
      desc: "(migrate balance, has some pending redeeming and minting basket, valid)",
      expectedError: null,
      initialFolioBasket: [
        new TokenAmount(MINTS[0].publicKey, new BN(100), new BN(0)),
        new TokenAmount(MINTS[1].publicKey, new BN(200), new BN(100)),
      ],
      tokens: [MINTS[0].publicKey, MINTS[1].publicKey],
      // Folio has 1000 total of each (negative as the old folio is losing them)
      expectedTokenBalanceChanges: [new BN(900).neg(), new BN(300).neg()],
    },
    {
      desc: "(migrate balance, has no pending redeeming and minting basket, valid)",
      expectedError: null,
      tokens: [MINTS[0].publicKey, MINTS[1].publicKey],
      // Folio has 1000 total of each (negative as the old folio is losing them)
      expectedTokenBalanceChanges: [new BN(1000).neg(), new BN(1000).neg()],
    },
  ];

  async function initBaseCase(
    customFolioTokenMint: Keypair = null,
    secondFolioOwner: PublicKey = null,
    initialFolioBasket: TokenAmount[] = [],
    // When second step of migration, we expect some changes to already be done
    isMigrating: boolean = false
  ) {
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
      false
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

    // Change the oner of the second folio if required
    if (secondFolioOwner) {
      const secondFolioAccount = await banksClient.getAccount(newFolioPDA);
      context.setAccount(newFolioPDA, {
        ...secondFolioAccount,
        owner: secondFolioOwner,
      });
    }

    initToken(
      context,
      isMigrating ? newFolioPDA : oldFolioPDA,
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
      programFolioSecond.programId,
    ]);

    await createAndSetFolioBasket(
      context,
      programFolio,
      oldFolioPDA,
      MINTS.map((mint) => new TokenAmount(mint.publicKey, new BN(0), new BN(0)))
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

    await airdrop(context, payerKeypair.publicKey, 1000);
    await airdrop(context, adminKeypair.publicKey, 1000);
    await airdrop(context, folioOwnerKeypair.publicKey, 1000);

    oldFolioPDA = getFolioPDA(folioTokenMint.publicKey);
    newFolioPDA = getFolioPDA(folioTokenMint.publicKey, true);

    await initBaseCase();
  });

  describe("General Tests", () => {
    const generalIxStartMigration = () =>
      startFolioMigration<true>(
        banksClient,
        programFolio,
        folioOwnerKeypair,
        folioTokenMint.publicKey,
        oldFolioPDA,
        newFolioPDA,
        programFolioSecond.programId,
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
      await initBaseCase();
    });

    describe("should run general tests for start folio migration", () => {
      it(`should run ${GeneralTestCases.NotOwner}`, async () => {
        await assertNotOwnerTestCase(
          context,
          programFolio,
          folioOwnerKeypair,
          oldFolioPDA,
          generalIxStartMigration
        );
      });

      it(`should run ${GeneralTestCases.InvalidFolioStatus} for MIGRATING & KILLED & INITIALIZING`, async () => {
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
          FolioStatus.Killed
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

  describe("Specific Cases", () => {
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
              banksClient,
              programFolio,
              folioOwnerKeypair,
              folioTokenMint.publicKey,
              oldFolioPDA,
              newFolioPDA,
              newFolioProgram || programFolioSecond.programId,
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
            });

            assertExpectedBalancesChanges(
              context,
              beforeBalances,
              tokens,
              [oldFolioPDA, newFolioPDA],
              expectedTokenBalanceChanges
            );
          }
        });
      }
    );
  });
});
