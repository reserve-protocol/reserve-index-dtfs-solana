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

import { getFolioSignerPDA } from "../../../utils/pda-helper";
import * as assert from "assert";
import { initFolioSigner } from "../bankrun-ix-helper";
import {
  assertNonAdminTestCase,
  GeneralTestCases,
} from "../bankrun-general-tests-helper";

describe("Bankrun - Init folio signer", () => {
  let context: ProgramTestContext;
  let provider: BankrunProvider;
  let banksClient: BanksClient;

  let programFolio: Program<Folio>;

  let keys: any;

  let payerKeypair: Keypair;
  let adminKeypair: Keypair;

  let folioSignerPDA: PublicKey;

  const TEST_CASES = [
    {
      desc: "(admin and init)",
      getKeypair: () => adminKeypair,
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

    folioSignerPDA = getFolioSignerPDA();
  });

  describe("General Tests", () => {
    const generalIx = () =>
      initFolioSigner<false>(banksClient, programFolio, adminKeypair, false);

    it(`should run ${GeneralTestCases.NotAdmin}`, async () => {
      await assertNonAdminTestCase(context, generalIx);
    });
  });

  TEST_CASES.forEach(({ desc, expectedError, getKeypair }) => {
    describe(`When ${desc}`, () => {
      let txnResult: BanksTransactionResultWithMeta;

      before(async () => {
        txnResult = await initFolioSigner<true>(
          banksClient,
          programFolio,
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

          const folioSigner =
            await programFolio.account.folioProgramSigner.fetch(folioSignerPDA);
          assert.notEqual(folioSigner, null);
        });
      }
    });
  });
});
