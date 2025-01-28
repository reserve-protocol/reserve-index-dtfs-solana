import { Program } from "@coral-xyz/anchor";
import { BankrunProvider } from "anchor-bankrun";
import { Keypair, PublicKey } from "@solana/web3.js";
import { Folio } from "../../../target/types/folio";
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
import { createAndSetProgramRegistrar } from "../bankrun-account-helper";
import { DTF_PROGRAM_ID } from "../../../utils/constants";
import {
  runMultipleGeneralTests,
  GeneralTestCases,
} from "../bankrun-general-tests-helper";

describe("Bankrun - Program Registrar", () => {
  let context: ProgramTestContext;
  let provider: BankrunProvider;
  let banksClient: BanksClient;

  let programFolio: Program<Folio>;

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
        addedPrograms: [DTF_PROGRAM_ID],
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
        addedPrograms: [DTF_PROGRAM_ID],
        removedPrograms: [],
      },
      expectedError: "InvalidProgramCount",
    },
    {
      desc: "(add one, is empty)",
      preAddedPrograms: [],
      programIdChanges: {
        addedPrograms: [DTF_PROGRAM_ID],
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
        addedPrograms: [DTF_PROGRAM_ID],
        removedPrograms: [],
      },
      expectedError: null,
    },
    {
      desc: "(remove one, is empty)",
      preAddedPrograms: [DTF_PROGRAM_ID],
      programIdChanges: {
        addedPrograms: [],
        removedPrograms: [DTF_PROGRAM_ID],
      },
      expectedError: null,
    },
    {
      desc: "(remove one, is full)",
      preAddedPrograms: [
        ...Array(MAX_NUMBER_OF_PROGRAMS - 1).fill(Keypair.generate().publicKey),
        DTF_PROGRAM_ID,
      ],
      programIdChanges: {
        addedPrograms: [],
        removedPrograms: [DTF_PROGRAM_ID],
      },
      expectedError: null,
    },
  ];

  before(async () => {
    ({ keys, programFolio, provider, context } = await getConnectors());

    banksClient = context.banksClient;

    payerKeypair = provider.wallet.payer;

    adminKeypair = Keypair.fromSecretKey(Uint8Array.from(keys.admin));

    await airdrop(context, payerKeypair.publicKey, 1000);
    await airdrop(context, adminKeypair.publicKey, 1000);
  });

  describe("General Tests", () => {
    const generalIx = () =>
      initProgramRegistrar<false>(
        banksClient,
        programFolio,
        adminKeypair,
        DTF_PROGRAM_ID
      );

    it("should run general tests", async () => {
      await runMultipleGeneralTests(
        [GeneralTestCases.NotAdmin],
        context,
        null,
        payerKeypair,
        null,
        null,
        null,
        null,
        generalIx
      );
    });
  });

  TEST_CASES_INIT.forEach(({ desc, expectedError, ...restOfParams }) => {
    describe(`Init - When ${desc}`, () => {
      let txnResult: BanksTransactionResultWithMeta;
      let {
        programIdChanges: { addedPrograms },
        getKeypair,
      } = { ...DEFAULT_PARAMS, ...restOfParams };

      before(async () => {
        txnResult = await initProgramRegistrar<true>(
          banksClient,
          programFolio,
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
            await programFolio.account.programRegistrar.fetch(
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

  describe("General Tests", () => {
    const generalIx = () =>
      updateProgramRegistrar<false>(
        banksClient,
        programFolio,
        adminKeypair,
        [DTF_PROGRAM_ID],
        false
      );

    it("should run general tests", async () => {
      await runMultipleGeneralTests(
        [GeneralTestCases.NotAdmin],
        context,
        null,
        payerKeypair,
        null,
        null,
        null,
        null,
        generalIx
      );
    });
  });

  TEST_CASES_UPDATE.forEach(({ desc, expectedError, ...restOfParams }) => {
    describe(`Update - When ${desc}`, () => {
      let txnResult: BanksTransactionResultWithMeta;
      let {
        preAddedPrograms,
        programIdChanges: { addedPrograms, removedPrograms },
        getKeypair,
      } = { ...DEFAULT_PARAMS, ...restOfParams };

      before(async () => {
        await createAndSetProgramRegistrar(
          context,
          programFolio,
          preAddedPrograms
        );

        await travelFutureSlot(context);

        txnResult = await updateProgramRegistrar<true>(
          banksClient,
          programFolio,
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
            await programFolio.account.programRegistrar.fetch(
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

          assert.deepEqual(programRegistrar.acceptedPrograms, expectedPrograms);
        });
      }
    });
  });
});
