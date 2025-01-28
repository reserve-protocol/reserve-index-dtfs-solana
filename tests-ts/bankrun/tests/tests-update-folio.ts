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
  buildExpectedArray,
  getConnectors,
  travelFutureSlot,
} from "../bankrun-program-helper";

import {
  getFolioFeeRecipientsPDA,
  getFolioPDA,
  getProgramDataPDA,
} from "../../../utils/pda-helper";
import { updateFolio } from "../bankrun-ix-helper";
import {
  createAndSetFolio,
  createAndSetProgramRegistrar,
  Role,
  createAndSetActor,
  FeeRecipient,
  createAndSetFeeRecipients,
  mockDTFProgramData,
  createAndSetDTFProgramSigner,
} from "../bankrun-account-helper";
import { Folio } from "../../../target/types/folio";
import { Dtfs } from "../../../target/types/dtfs";
import {
  assertInvalidDtfProgramDeploymentSlotTestCase,
  assertNotOwnerTestCase,
  assertProgramNotInRegistrarTestCase,
  GeneralTestCases,
} from "../bankrun-general-tests-helper";

import * as assert from "assert";
import {
  DTF_PROGRAM_ID,
  MAX_FEE_RECIPIENTS,
  MAX_MINTING_FEE,
  MIN_AUCTION_LENGTH,
  MIN_DAO_MINTING_FEE,
} from "../../../utils/constants";
import { MAX_AUCTION_LENGTH } from "../../../utils/constants";
import { MAX_TRADE_DELAY } from "../../../utils/constants";
import { MAX_FOLIO_FEE } from "../../../utils/constants";

describe("Bankrun - Update folio", () => {
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

  const VALID_DEPLOYMENT_SLOT = new BN(1);

  const FEE_PORTION_SUM = new BN(1000000000);
  const EQUAL_PORTION = FEE_PORTION_SUM.div(new BN(MAX_FEE_RECIPIENTS));

  const FEE_RECIPIENT_KEYPAIR = Keypair.generate();
  const PROGRAM_VERSION_VALID = Keypair.generate().publicKey;

  const DEFAULT_PARAMS: {
    programVersion: PublicKey;
    programDeploymentSlot: BN;
    folioFee: BN;
    mintingFee: BN;
    tradeDelay: BN;
    auctionLength: BN;
    preAddedRecipients: FeeRecipient[];
    feeRecipientsToAdd: FeeRecipient[];
    feeRecipientsToRemove: PublicKey[];
  } = {
    programVersion: DTF_PROGRAM_ID,
    programDeploymentSlot: VALID_DEPLOYMENT_SLOT,
    folioFee: MAX_FOLIO_FEE,
    mintingFee: MIN_DAO_MINTING_FEE,
    tradeDelay: MAX_TRADE_DELAY,
    auctionLength: MAX_AUCTION_LENGTH,
    preAddedRecipients: [],
    feeRecipientsToAdd: [],
    feeRecipientsToRemove: [],
  };

  const TEST_CASES = [
    {
      desc: "(should update program version only, not in the program registrar)",
      programVersion: Keypair.generate().publicKey,
      expectedError: "ProgramNotInRegistrar",
    },
    {
      desc: "(should update program version only, success)",
      programVersion: PROGRAM_VERSION_VALID,
      expectedError: null,
    },
    {
      desc: "(should update deployment slot only, success)",
      programDeploymentSlot: VALID_DEPLOYMENT_SLOT.add(new BN(1)),
      expectedError: null,
    },
    {
      desc: "(should update program version and deployment slot, success)",
      programVersion: PROGRAM_VERSION_VALID,
      programDeploymentSlot: VALID_DEPLOYMENT_SLOT.add(new BN(1)),
      expectedError: null,
    },
    {
      desc: "(should update folio fee, fee too high)",
      folioFee: MAX_FOLIO_FEE.add(new BN(1)),
      expectedError: "InvalidFeePerSecond",
    },
    {
      desc: "(should update folio fee, success)",
      folioFee: MAX_FOLIO_FEE.sub(new BN(1)),
      expectedError: null,
    },
    {
      desc: "(should update minting fee, fee too low)",
      mintingFee: MIN_DAO_MINTING_FEE.sub(new BN(1)),
      expectedError: "InvalidMintingFee",
    },
    {
      desc: "(should update minting fee, fee too high)",
      mintingFee: MAX_MINTING_FEE.add(new BN(1)),
      expectedError: "InvalidMintingFee",
    },
    {
      desc: "(should update minting fee, success)",
      mintingFee: MAX_MINTING_FEE.sub(new BN(1)),
      expectedError: null,
    },
    {
      desc: "(should update trade delay, delay too high)",
      tradeDelay: MAX_TRADE_DELAY.add(new BN(1)),
      expectedError: "InvalidTradeDelay",
    },
    {
      desc: "(should update trade delay, success)",
      tradeDelay: MAX_TRADE_DELAY.sub(new BN(1)),
      expectedError: null,
    },
    {
      desc: "(should update auction length, length too low)",
      auctionLength: MIN_AUCTION_LENGTH.sub(new BN(1)),
      expectedError: "InvalidAuctionLength",
    },
    {
      desc: "(should update auction length, length too high)",
      auctionLength: MAX_AUCTION_LENGTH.add(new BN(1)),
      expectedError: "InvalidAuctionLength",
    },
    {
      desc: "(should update auction length, success)",
      auctionLength: MAX_AUCTION_LENGTH.sub(new BN(1)),
      expectedError: null,
    },
    {
      desc: "(should update fee recipients, too many)",
      preAddedRecipients: Array(MAX_FEE_RECIPIENTS).fill(
        new FeeRecipient(Keypair.generate().publicKey, EQUAL_PORTION)
      ),
      feeRecipientsToAdd: [
        new FeeRecipient(Keypair.generate().publicKey, EQUAL_PORTION),
      ],
      expectedError: "InvalidFeeRecipientCount",
    },
    {
      desc: "(should update fee recipients, full but remove 1 and add 1, success)",
      preAddedRecipients: Array(MAX_FEE_RECIPIENTS - 1)
        .fill(new FeeRecipient(Keypair.generate().publicKey, EQUAL_PORTION))
        .concat([
          new FeeRecipient(FEE_RECIPIENT_KEYPAIR.publicKey, EQUAL_PORTION),
        ]),
      feeRecipientsToAdd: [
        new FeeRecipient(Keypair.generate().publicKey, EQUAL_PORTION),
      ],
      feeRecipientsToRemove: [FEE_RECIPIENT_KEYPAIR.publicKey],
      expectedError: null,
    },
    {
      desc: "(should update fee recipients, remove and add same one)",
      preAddedRecipients: [],
      feeRecipientsToAdd: [
        new FeeRecipient(FEE_RECIPIENT_KEYPAIR.publicKey, FEE_PORTION_SUM),
      ],
      feeRecipientsToRemove: [FEE_RECIPIENT_KEYPAIR.publicKey],
      expectedError: null,
    },
    {
      desc: "(should update fee recipients, fee portion sum too high)",
      preAddedRecipients: [
        new FeeRecipient(FEE_RECIPIENT_KEYPAIR.publicKey, FEE_PORTION_SUM),
      ],
      feeRecipientsToAdd: [
        new FeeRecipient(FEE_RECIPIENT_KEYPAIR.publicKey, new BN(1)),
      ],
      feeRecipientsToRemove: [],
      expectedError: "InvalidFeeRecipientPortion",
    },
    {
      desc: "(should update fee recipients, fee portion sum too low)",
      preAddedRecipients: [
        new FeeRecipient(
          FEE_RECIPIENT_KEYPAIR.publicKey,
          FEE_PORTION_SUM.sub(new BN(2))
        ),
      ],
      feeRecipientsToAdd: [
        new FeeRecipient(FEE_RECIPIENT_KEYPAIR.publicKey, new BN(1)),
      ],
      feeRecipientsToRemove: [],
      expectedError: "InvalidFeeRecipientPortion",
    },
  ];

  async function initBaseCase() {
    await createAndSetDTFProgramSigner(context, programDtf);
    await createAndSetProgramRegistrar(context, programFolio, [
      DTF_PROGRAM_ID,
      PROGRAM_VERSION_VALID,
    ]);

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
    const generalIxUpdateFolio = () =>
      updateFolio<true>(
        banksClient,
        programDtf,
        folioOwnerKeypair,
        folioPDA,
        null,
        null,
        null,
        null,
        null,
        null,
        [],
        [],
        DTF_PROGRAM_ID,
        getProgramDataPDA(DTF_PROGRAM_ID),
        true
      );

    beforeEach(async () => {
      await initBaseCase();
    });

    it(`should run ${GeneralTestCases.NotOwner}`, async () => {
      await assertNotOwnerTestCase(
        context,
        programFolio,
        folioOwnerKeypair,
        folioPDA,
        generalIxUpdateFolio
      );
    });

    it(`should run ${GeneralTestCases.InvalidDtfProgramDeploymentSlot}`, async () => {
      await assertInvalidDtfProgramDeploymentSlotTestCase(
        context,
        VALID_DEPLOYMENT_SLOT.add(new BN(1)),
        generalIxUpdateFolio
      );
    });

    it(`should run ${GeneralTestCases.ProgramNotInRegistrar}`, async () => {
      await assertProgramNotInRegistrarTestCase(
        context,
        programFolio,
        generalIxUpdateFolio
      );
    });
  });

  /*
  Then the test cases specific to that instruction
  */
  describe("Specific Cases", () => {
    TEST_CASES.forEach(({ desc, expectedError, ...restOfParams }) => {
      describe(`When ${desc}`, () => {
        let txnResult: BanksTransactionResultWithMeta;
        const {
          programVersion,
          programDeploymentSlot,
          folioFee,
          mintingFee,
          tradeDelay,
          auctionLength,
          feeRecipientsToAdd,
          feeRecipientsToRemove,
          preAddedRecipients,
        } = { ...DEFAULT_PARAMS, ...restOfParams };

        before(async () => {
          await initBaseCase();

          await createAndSetFeeRecipients(
            context,
            programFolio,
            folioPDA,
            preAddedRecipients
          );

          await travelFutureSlot(context);

          txnResult = await updateFolio<true>(
            banksClient,
            programDtf,
            folioOwnerKeypair,
            folioPDA,
            programVersion,
            programDeploymentSlot,
            folioFee,
            mintingFee,
            tradeDelay,
            auctionLength,
            feeRecipientsToAdd,
            feeRecipientsToRemove,
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

            const folio = await programFolio.account.folio.fetch(folioPDA);

            assert.deepEqual(folio.programVersion, programVersion);
            assert.equal(
              folio.programDeploymentSlot.eq(programDeploymentSlot),
              true
            );
            assert.equal(folio.folioFee.eq(folioFee), true);
            assert.equal(folio.mintingFee.eq(mintingFee), true);
            assert.equal(folio.tradeDelay.eq(tradeDelay), true);
            assert.equal(folio.auctionLength.eq(auctionLength), true);

            const feeRecipients =
              await programFolio.account.feeRecipients.fetch(
                getFolioFeeRecipientsPDA(folioPDA)
              );

            const expectedFeeRecipients = buildExpectedArray(
              preAddedRecipients,
              feeRecipientsToAdd,
              feeRecipientsToRemove,
              MAX_FEE_RECIPIENTS,
              {
                receiver: PublicKey.default,
                portion: new BN(0),
              },
              (feeRecipient) =>
                !feeRecipientsToRemove.some((pk) =>
                  pk.equals(feeRecipient.receiver)
                )
            );

            for (let i = 0; i < MAX_FEE_RECIPIENTS; i++) {
              assert.equal(
                feeRecipients.feeRecipients[i].receiver.toString(),
                expectedFeeRecipients[i].receiver.toString()
              );
              assert.equal(
                feeRecipients.feeRecipients[i].portion.eq(
                  expectedFeeRecipients[i].portion
                ),
                true
              );
            }
          });
        }
      });
    });
  });
});
