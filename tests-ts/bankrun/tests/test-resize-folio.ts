import { BN, Program } from "@coral-xyz/anchor";
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
  getConnectors,
  travelFutureSlot,
} from "../bankrun-program-helper";

import { getFolioPDA, getProgramDataPDA } from "../../../utils/pda-helper";
import { resizeFolio } from "../bankrun-ix-helper";
import {
  createAndSetActor,
  createAndSetFolio,
  createAndSetDTFProgramSigner,
  Role,
  createAndSetProgramRegistrar,
  mockDTFProgramData,
} from "../bankrun-account-helper";
import { assert } from "chai";
import { Folio } from "../../../target/types/folio";
import { Dtfs } from "../../../target/types/dtfs";
import {
  GeneralTestCases,
  runMultipleGeneralTests,
} from "../bankrun-general-tests-helper";
import { DTF_PROGRAM_ID } from "../../../utils/constants";

describe("Bankrun - Resize folio", () => {
  let context: ProgramTestContext;
  let provider: BankrunProvider;
  let banksClient: BanksClient;

  let programDtf: Program<Dtfs>;
  let programFolio: Program<Folio>;

  let keys: any;

  let payerKeypair: Keypair;
  let adminKeypair: Keypair;

  let folioOwnerKeypair: Keypair;

  let folioTokenMint: Keypair;

  let folioPDA: PublicKey;

  const BASE_FOLIO_SIZE = 808;
  const VALID_DEPLOYMENT_SLOT = new BN(1);

  const DEFAULT_PARAMS: {
    size: number;
  } = {
    size: BASE_FOLIO_SIZE,
  };

  const TEST_CASES = [
    {
      desc: "(should resize successfully)",
      size: BASE_FOLIO_SIZE + 1,
      expectedError: null,
    },
  ];

  async function initBaseCase() {
    await createAndSetDTFProgramSigner(context, programDtf);
    await createAndSetProgramRegistrar(context, programFolio, [DTF_PROGRAM_ID]);

    await createAndSetFolio(
      context,
      programFolio,
      folioTokenMint.publicKey,
      DTF_PROGRAM_ID,
      VALID_DEPLOYMENT_SLOT
    );

    await createAndSetActor(
      context,
      programFolio,
      folioOwnerKeypair,
      folioPDA,
      Role.Owner
    );

    await mockDTFProgramData(context, DTF_PROGRAM_ID, VALID_DEPLOYMENT_SLOT);
  }

  before(async () => {
    ({ keys, programDtf, programFolio, provider, context } =
      await getConnectors());

    banksClient = context.banksClient;

    payerKeypair = provider.wallet.payer;

    adminKeypair = Keypair.fromSecretKey(Uint8Array.from(keys.admin));

    folioOwnerKeypair = Keypair.generate();
    folioTokenMint = Keypair.generate();

    await airdrop(context, payerKeypair.publicKey, 1000);
    await airdrop(context, adminKeypair.publicKey, 1000);
    await airdrop(context, folioOwnerKeypair.publicKey, 1000);

    folioPDA = getFolioPDA(folioTokenMint.publicKey);

    await initBaseCase();
  });

  describe("General Tests", () => {
    const generalIx = () =>
      resizeFolio<true>(
        banksClient,
        programDtf,
        folioOwnerKeypair,
        folioPDA,
        new BN(BASE_FOLIO_SIZE),
        DTF_PROGRAM_ID,
        getProgramDataPDA(DTF_PROGRAM_ID)
      );

    it("should run general tests", async () => {
      await runMultipleGeneralTests(
        [
          GeneralTestCases.NotOwner,
          GeneralTestCases.InvalidDtfProgramDeploymentSlot,
          GeneralTestCases.ProgramNotInRegistrar,
        ],
        context,
        programFolio,
        folioOwnerKeypair,
        folioPDA,
        VALID_DEPLOYMENT_SLOT,
        null,
        generalIx
      );
    });
  });

  /*
  Then the test cases specific to that instruction
  */
  TEST_CASES.forEach(({ desc, expectedError, ...restOfParams }) => {
    describe(`When ${desc}`, () => {
      let txnResult: BanksTransactionResultWithMeta;
      const { size } = { ...DEFAULT_PARAMS, ...restOfParams };

      before(async () => {
        await initBaseCase();

        txnResult = await resizeFolio<true>(
          banksClient,
          programDtf,
          folioOwnerKeypair,
          folioPDA,
          new BN(size),
          DTF_PROGRAM_ID,
          getProgramDataPDA(DTF_PROGRAM_ID)
        );
      });

      if (expectedError) {
        it("should fail with expected error", () => {
          assertError(txnResult, expectedError);
        });
      } else {
        it("should succeed", async () => {
          await travelFutureSlot(context);

          const folioSize =
            await programFolio.provider.connection.getAccountInfo(folioPDA);

          assert.equal(folioSize.data.byteLength, size);
        });
      }
    });
  });
});
