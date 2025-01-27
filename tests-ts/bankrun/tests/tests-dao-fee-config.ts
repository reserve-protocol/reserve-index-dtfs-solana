import { BN, Program } from "@coral-xyz/anchor";
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
import { setDaoFeeConfig } from "../bankrun-ix-helper";
import { getDAOFeeConfigPDA } from "../../../utils/pda-helper";
import * as assert from "assert";
import { getNonAdminTestCase } from "../bankrun-general-tests-helper";
import { createAndSetDaoFeeConfig } from "../bankrun-account-helper";

describe("Bankrun - Dao Fee Config Tests", () => {
  let context: ProgramTestContext;
  let provider: BankrunProvider;
  let banksClient: BanksClient;

  let programDtf: Program<Dtfs>;
  let keys: any;

  let payerKeypair: Keypair;
  let adminKeypair: Keypair;

  let daoFeeConfigPDA: PublicKey;

  const defaultParams = {
    existsBefore: false,
    expectedFeeRecipient: Keypair.generate().publicKey,
    expectedFeeNumerator: new BN(10),
  };

  const testCases = [
    getNonAdminTestCase(() => payerKeypair),
    {
      desc: "(fee recipient numerator too high)",
      getKeypair: () => adminKeypair,
      expectedError: "InvalidFeeNumerator",
      expectedFeeNumerator: new BN("1000000000000000000"),
    },
    {
      desc: "(admin and init)",
      getKeypair: () => adminKeypair,
      expectedError: null,
      expectedFeeNumerator: new BN(10),
    },
    {
      desc: "(admin and update)",
      getKeypair: () => adminKeypair,
      expectedError: null,
      existsBefore: true,
      expectedFeeNumerator: new BN(20),
    },
  ];

  before(async () => {
    ({ keys, programDtf, provider, context } = await getConnectors());

    banksClient = context.banksClient;

    payerKeypair = provider.wallet.payer;

    adminKeypair = Keypair.fromSecretKey(Uint8Array.from(keys.admin));

    await airdrop(context, payerKeypair.publicKey, 1000);
    await airdrop(context, adminKeypair.publicKey, 1000);

    daoFeeConfigPDA = getDAOFeeConfigPDA();
  });

  testCases.forEach(({ desc, expectedError, getKeypair, ...restOfParams }) => {
    describe(`When ${desc}`, () => {
      const { existsBefore, expectedFeeRecipient, expectedFeeNumerator } = {
        ...defaultParams,
        ...restOfParams,
      };

      let txnResult: BanksTransactionResultWithMeta;

      before(async () => {
        if (existsBefore) {
          await createAndSetDaoFeeConfig(
            context,
            programDtf,
            expectedFeeRecipient,
            expectedFeeNumerator
          );
          await travelFutureSlot(context);
        }

        txnResult = await setDaoFeeConfig(
          banksClient,
          programDtf,
          getKeypair(),
          expectedFeeRecipient,
          expectedFeeNumerator
        );

        await travelFutureSlot(context);
      });

      if (expectedError) {
        it("should fail with expected error", () => {
          assertError(txnResult, expectedError);
        });
      } else {
        it("should succeed", async () => {
          const daoFeeConfig = await programDtf.account.daoFeeConfig.fetch(
            daoFeeConfigPDA
          );
          assert.equal(
            daoFeeConfig.feeRecipient.toBase58(),
            expectedFeeRecipient.toBase58()
          );
          assert.equal(
            daoFeeConfig.feeRecipientNumerator.toString(),
            expectedFeeNumerator.toString()
          );
        });
      }
    });
  });
});
