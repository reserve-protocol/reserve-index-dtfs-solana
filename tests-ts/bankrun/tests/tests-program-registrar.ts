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
  getConnectors,
  travelFutureSlot,
} from "../bankrun-program-helper";
import { getNonAdminTestCase } from "../bankrun-general-tests-helper";

import {
  DTF_PROGRAM_ID,
  getProgramRegistrarPDA,
} from "../../../utils/pda-helper";
import {
  initProgramRegistrar,
  updateProgramRegistrar,
} from "../bankrun-ix-helper";
import * as assert from "assert";
import { createAndSetProgramRegistrar } from "../bankrun-account-helper";
describe("Bankrun - Program Registrar", () => {
  let context: ProgramTestContext;
  let provider: BankrunProvider;
  let banksClient: BanksClient;

  let programFolio: Program<Folio>;

  let keys: any;

  let payerKeypair: Keypair;
  let adminKeypair: Keypair;

  const defaultParams = {
    preAddedPrograms: [],
    programIdChanges: {
      addedPrograms: [],
      removedPrograms: [],
    },
    getKeypair: () => adminKeypair,
  };

  const testCasesInit = [
    getNonAdminTestCase(() => payerKeypair),
    {
      desc: "(add one)",
      programIdChanges: {
        addedPrograms: [DTF_PROGRAM_ID],
        removedPrograms: [],
      },
      expectedError: null,
    },
  ];

  const testCasesUpdate = [
    getNonAdminTestCase(() => payerKeypair),
    {
      desc: "(no more room to add)",
      preAddedPrograms: Array(10).fill(Keypair.generate().publicKey),
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
      preAddedPrograms: Array(9).fill(Keypair.generate().publicKey),
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
        ...Array(9).fill(Keypair.generate().publicKey),
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

  testCasesInit.forEach(({ desc, expectedError, ...restOfParams }) => {
    describe(`Init - When ${desc}`, () => {
      let txnResult: BanksTransactionResultWithMeta;
      let {
        programIdChanges: { addedPrograms },
        getKeypair,
      } = { ...defaultParams, ...restOfParams };

      before(async () => {
        txnResult = await initProgramRegistrar(
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
          const programRegistrarPDA = getProgramRegistrarPDA();

          const programRegistrar =
            await programFolio.account.programRegistrar.fetch(
              programRegistrarPDA
            );

          assert.deepEqual(programRegistrar.acceptedPrograms, [
            addedPrograms[0],
            ...Array(9).fill(PublicKey.default),
          ]);
        });
      }
    });
  });

  testCasesUpdate.forEach(({ desc, expectedError, ...restOfParams }) => {
    describe(`Update - When ${desc}`, () => {
      let txnResult: BanksTransactionResultWithMeta;
      let {
        preAddedPrograms,
        programIdChanges: { addedPrograms, removedPrograms },
        getKeypair,
      } = { ...defaultParams, ...restOfParams };

      before(async () => {
        // Reset the program registrar to empty
        await createAndSetProgramRegistrar(
          context,
          programFolio,
          preAddedPrograms
        );

        // Test the transaction
        txnResult = await updateProgramRegistrar(
          banksClient,
          programFolio,
          getKeypair(),
          addedPrograms.length > 0 ? addedPrograms : removedPrograms,
          removedPrograms.length > 0
        );

        await travelFutureSlot(context);
      });

      if (expectedError) {
        it("should fail with expected error", () => {
          assertError(txnResult, expectedError);
        });
      } else {
        it("should succeed", async () => {
          const programRegistrarPDA = getProgramRegistrarPDA();

          const programRegistrar =
            await programFolio.account.programRegistrar.fetch(
              programRegistrarPDA
            );

          // Build the expected programs array
          const expectedPrograms = preAddedPrograms
            .concat(addedPrograms)
            .filter((program) => !removedPrograms.includes(program))
            .concat(
              Array(
                10 -
                  preAddedPrograms.length -
                  addedPrograms.length +
                  removedPrograms.length
              ).fill(PublicKey.default)
            );

          assert.deepEqual(programRegistrar.acceptedPrograms, expectedPrograms);
        });
      }
    });
  });
});
