import { Program } from "@coral-xyz/anchor";
import { BankrunProvider } from "anchor-bankrun";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  BanksClient,
  BanksTransactionResultWithMeta,
  ProgramTestContext,
} from "solana-bankrun";
import {
  airdrop,
  assertError,
  buildExpectedArray,
  getConnectors,
  travelFutureSlot,
} from "../bankrun-program-helper";

import { getProgramRegistrarPDA } from "../../../utils/pda-helper";
import {
  initProgramRegistrar,
  updateProgramRegistrar,
} from "../bankrun-ix-helper";
import * as assert from "assert";
import {
  closeAccount,
  createAndSetProgramRegistrar,
} from "../bankrun-account-helper";
import {
  GeneralTestCases,
  assertNonAdminTestCase,
} from "../bankrun-general-tests-helper";
import { FOLIO_PROGRAM_ID } from "../../../utils/constants";
import { FolioAdmin } from "../../../target/types/folio_admin";

/**
 * Tests for program registrar functionality, including:
 * - Initializing program registrar
 * - Adding/removing programs
 * - Program limit validation
 * - Admin permission checks
 */

describe("Bankrun - Program Registrar", () => {
  let context: ProgramTestContext;
  let provider: BankrunProvider;
  let banksClient: BanksClient;

  let programFolioAdmin: Program<FolioAdmin>;

  let keys: any;

  let payerKeypair: Keypair;
  let adminKeypair: Keypair;

  const MAX_NUMBER_OF_PROGRAMS = 10;

  const DEFAULT_PARAMS: {
    preAddedPrograms: PublicKey[];
    programIdChanges: {
      addedPrograms: PublicKey[];
      removedPrograms: PublicKey[];
    };
    getKeypair: () => Keypair;
  } = {
    preAddedPrograms: [],
    programIdChanges: {
      addedPrograms: [],
      removedPrograms: [],
    },
    getKeypair: () => adminKeypair,
  };

  const TEST_CASES_INIT = [
    {
      desc: "(add one)",
      programIdChanges: {
        addedPrograms: [FOLIO_PROGRAM_ID],
        removedPrograms: [],
      },
      expectedError: null,
    },
  ];

  const TEST_CASES_UPDATE = [
    {
      desc: "(no more room to add)",
      preAddedPrograms: Array(MAX_NUMBER_OF_PROGRAMS).fill(
        Keypair.generate().publicKey
      ),
      programIdChanges: {
        addedPrograms: [FOLIO_PROGRAM_ID],
        removedPrograms: [],
      },
      expectedError: "InvalidProgramCount",
    },
    {
      desc: "(add one, is empty)",
      preAddedPrograms: [],
      programIdChanges: {
        addedPrograms: [FOLIO_PROGRAM_ID],
        removedPrograms: [],
      },
      expectedError: null,
    },
    {
      desc: "(add one, one room left)",
      preAddedPrograms: Array(MAX_NUMBER_OF_PROGRAMS - 1).fill(
        Keypair.generate().publicKey
      ),
      programIdChanges: {
        addedPrograms: [FOLIO_PROGRAM_ID],
        removedPrograms: [],
      },
      expectedError: null,
    },
    {
      desc: "(remove one, is empty)",
      preAddedPrograms: [FOLIO_PROGRAM_ID],
      programIdChanges: {
        addedPrograms: [],
        removedPrograms: [FOLIO_PROGRAM_ID],
      },
      expectedError: null,
    },
    {
      desc: "(remove one, is full)",
      preAddedPrograms: [
        ...Array(MAX_NUMBER_OF_PROGRAMS - 1).fill(Keypair.generate().publicKey),
        FOLIO_PROGRAM_ID,
      ],
      programIdChanges: {
        addedPrograms: [],
        removedPrograms: [FOLIO_PROGRAM_ID],
      },
      expectedError: null,
    },
  ];

  before(async () => {
    ({ keys, programFolioAdmin, provider, context } = await getConnectors());

    banksClient = context.banksClient;

    payerKeypair = provider.wallet.payer;

    adminKeypair = Keypair.fromSecretKey(Uint8Array.from(keys.admin));

    await airdrop(context, payerKeypair.publicKey, 1000);
    await airdrop(context, adminKeypair.publicKey, 1000);
  });

  describe("General Tests", () => {
    const generalIxInitProgramRegistrar = () =>
      initProgramRegistrar<false>(
        banksClient,
        programFolioAdmin,
        adminKeypair,
        FOLIO_PROGRAM_ID,
        false
      );

    const generalIxUpdateProgramRegistrar = () =>
      updateProgramRegistrar<false>(
        banksClient,
        programFolioAdmin,
        adminKeypair,
        [FOLIO_PROGRAM_ID],
        false,
        false
      );

    describe("should run general tests for init program registrar", () => {
      it(`should run ${GeneralTestCases.NotAdmin}`, async () => {
        await assertNonAdminTestCase(context, generalIxInitProgramRegistrar);
      });
    });

    describe("should run general tests for update program registrar", () => {
      beforeEach(async () => {
        await createAndSetProgramRegistrar(context, programFolioAdmin, []);
      });

      it(`should run ${GeneralTestCases.NotAdmin}`, async () => {
        await assertNonAdminTestCase(context, generalIxUpdateProgramRegistrar);
      });
    });
  });

  describe("Specific Cases - Init Program Registrar", () => {
    TEST_CASES_INIT.forEach(({ desc, expectedError, ...restOfParams }) => {
      describe(`When ${desc}`, () => {
        let txnResult: BanksTransactionResultWithMeta;
        const {
          programIdChanges: { addedPrograms },
          getKeypair,
        } = { ...DEFAULT_PARAMS, ...restOfParams };

        before(async () => {
          // Close the account so we can re-init as if it was new
          await closeAccount(context, getProgramRegistrarPDA());

          txnResult = await initProgramRegistrar<true>(
            banksClient,
            programFolioAdmin,
            getKeypair(),
            addedPrograms[0]
          );
        });

        if (expectedError) {
          it("should fail with expected error", () => {
            assertError(txnResult, expectedError);
          });
        } else {
          it("should succeed", async () => {
            await travelFutureSlot(context);
            const programRegistrarPDA = getProgramRegistrarPDA();

            const programRegistrar =
              await programFolioAdmin.account.programRegistrar.fetch(
                programRegistrarPDA
              );

            assert.deepEqual(programRegistrar.acceptedPrograms, [
              addedPrograms[0],
              ...Array(MAX_NUMBER_OF_PROGRAMS - 1).fill(PublicKey.default),
            ]);
          });
        }
      });
    });
  });

  describe("Specific Cases - Update Program Registrar", () => {
    TEST_CASES_UPDATE.forEach(({ desc, expectedError, ...restOfParams }) => {
      describe(`Update - When ${desc}`, () => {
        let txnResult: BanksTransactionResultWithMeta;
        const {
          preAddedPrograms,
          programIdChanges: { addedPrograms, removedPrograms },
          getKeypair,
        } = { ...DEFAULT_PARAMS, ...restOfParams };

        before(async () => {
          await createAndSetProgramRegistrar(
            context,
            programFolioAdmin,
            preAddedPrograms
          );

          await travelFutureSlot(context);

          txnResult = await updateProgramRegistrar<true>(
            banksClient,
            programFolioAdmin,
            getKeypair(),
            addedPrograms.length > 0 ? addedPrograms : removedPrograms,
            removedPrograms.length > 0
          );
        });

        if (expectedError) {
          it("should fail with expected error", () => {
            assertError(txnResult, expectedError);
          });
        } else {
          it("should succeed", async () => {
            await travelFutureSlot(context);

            const programRegistrarPDA = getProgramRegistrarPDA();

            const programRegistrar =
              await programFolioAdmin.account.programRegistrar.fetch(
                programRegistrarPDA
              );

            const expectedPrograms = buildExpectedArray(
              preAddedPrograms,
              addedPrograms,
              removedPrograms,
              MAX_NUMBER_OF_PROGRAMS,
              PublicKey.default,
              (program) => !removedPrograms.includes(program)
            );

            assert.deepEqual(
              programRegistrar.acceptedPrograms,
              expectedPrograms
            );
          });
        }
      });
    });
  });
});
