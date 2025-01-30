import { Program } from "@coral-xyz/anchor";
import { BankrunProvider } from "anchor-bankrun";
import { Keypair, PublicKey } from "@solana/web3.js";
import { Dtfs } from "../../../target/types/dtfs";
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
import { initDtfSigner } from "../bankrun-ix-helper";
import * as assert from "assert";
import { getDtfSignerPDA } from "../../../utils/pda-helper";
import {
  assertNonAdminTestCase,
  GeneralTestCases,
} from "../bankrun-general-tests-helper";

describe("Bankrun - Init Dtf Signer Tests", () => {
  let context: ProgramTestContext;
  let provider: BankrunProvider;
  let banksClient: BanksClient;

  let programDtf: Program<Dtfs>;
  let keys: any;

  let payerKeypair: Keypair;
  let adminKeypair: Keypair;

  let dtfSignerPDA: PublicKey;

  const TEST_CASES = [
    {
      desc: "(admin and init)",
      getKeypair: () => adminKeypair,
      expectedError: null,
    },
  ];

  before(async () => {
    ({ keys, programDtf, provider, context } = await getConnectors());

    banksClient = context.banksClient;

    payerKeypair = provider.wallet.payer;

    adminKeypair = Keypair.fromSecretKey(Uint8Array.from(keys.admin));

    await airdrop(context, payerKeypair.publicKey, 1000);
    await airdrop(context, adminKeypair.publicKey, 1000);

    dtfSignerPDA = getDtfSignerPDA();
  });

  describe("General Tests", () => {
    const generalIx = () =>
      initDtfSigner<false>(banksClient, programDtf, adminKeypair, false);

    it(`should run ${GeneralTestCases.NotAdmin}`, async () => {
      await assertNonAdminTestCase(context, generalIx);
    });
  });

  TEST_CASES.forEach(({ desc, expectedError, getKeypair }) => {
    describe(`When ${desc}`, () => {
      let txnResult: BanksTransactionResultWithMeta;

      before(async () => {
        txnResult = await initDtfSigner<true>(
          banksClient,
          programDtf,
          getKeypair()
        );
      });

      if (expectedError) {
        it("should fail with expected error", () => {
          assertError(txnResult, expectedError);
        });
      } else {
        it("should succeed", async () => {
          await travelFutureSlot(context);

          const dtfSigner = await programDtf.account.dtfProgramSigner.fetch(
            dtfSignerPDA
          );
          assert.notEqual(dtfSigner, null);
        });
      }
    });
  });
});
