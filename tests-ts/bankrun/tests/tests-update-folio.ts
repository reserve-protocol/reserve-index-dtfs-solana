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

import { getTVLFeeRecipientsPDA, getFolioPDA } from "../../../utils/pda-helper";
import { updateFolio } from "../bankrun-ix-helper";
import {
  createAndSetFolio,
  Role,
  createAndSetActor,
  FeeRecipient,
  createAndSetFeeRecipients,
} from "../bankrun-account-helper";
import { Folio } from "../../../target/types/folio";
import {
  assertNotValidRoleTestCase,
  GeneralTestCases,
} from "../bankrun-general-tests-helper";

import * as assert from "assert";
import {
  MAX_FEE_RECIPIENTS,
  MAX_MINT_FEE,
  MIN_AUCTION_LENGTH,
  MIN_DAO_MINT_FEE,
} from "../../../utils/constants";
import { MAX_AUCTION_LENGTH } from "../../../utils/constants";
import { MAX_AUCTION_DELAY } from "../../../utils/constants";
import { MAX_TVL_FEE } from "../../../utils/constants";

describe("Bankrun - Update folio", () => {
  let context: ProgramTestContext;
  let provider: BankrunProvider;
  let banksClient: BanksClient;

  let programFolio: Program<Folio>;

  let keys: any;

  let payerKeypair: Keypair;
  let adminKeypair: Keypair;

  let folioOwnerKeypair: Keypair;

  let folioTokenMint: Keypair;

  let folioPDA: PublicKey;

  const FEE_PORTION_SUM = new BN(1000000000);
  const EQUAL_PORTION = FEE_PORTION_SUM.div(new BN(MAX_FEE_RECIPIENTS));

  const FEE_RECIPIENT_KEYPAIR = Keypair.generate();

  const DEFAULT_PARAMS: {
    tvlFee: BN;
    mintFee: BN;
    auctionDelay: BN;
    auctionLength: BN;
    preAddedRecipients: FeeRecipient[];
    feeRecipientsToAdd: FeeRecipient[];
    feeRecipientsToRemove: PublicKey[];
  } = {
    tvlFee: MAX_TVL_FEE,
    mintFee: MIN_DAO_MINT_FEE,
    auctionDelay: MAX_AUCTION_DELAY,
    auctionLength: MAX_AUCTION_LENGTH,
    preAddedRecipients: [],
    feeRecipientsToAdd: [],
    feeRecipientsToRemove: [],
  };

  const TEST_CASES = [
    {
      desc: "(should update folio fee, fee too high)",
      tvlFee: MAX_TVL_FEE.add(new BN(1)),
      expectedError: "InvalidFeePerSecond",
    },
    {
      desc: "(should update folio fee, success)",
      tvlFee: MAX_TVL_FEE.sub(new BN(1)),
      expectedError: null,
    },
    {
      desc: "(should update minting fee, fee too low)",
      mintFee: MIN_DAO_MINT_FEE.sub(new BN(1)),
      expectedError: "InvalidMintFee",
    },
    {
      desc: "(should update minting fee, fee too high)",
      mintFee: MAX_MINT_FEE.add(new BN(1)),
      expectedError: "InvalidMintFee",
    },
    {
      desc: "(should update minting fee, success)",
      mintFee: MAX_MINT_FEE.sub(new BN(1)),
      expectedError: null,
    },
    {
      desc: "(should update auction delay, delay too high)",
      auctionDelay: MAX_AUCTION_DELAY.add(new BN(1)),
      expectedError: "InvalidAuctionDelay",
    },
    {
      desc: "(should update auction delay, success)",
      auctionDelay: MAX_AUCTION_DELAY.sub(new BN(1)),
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
    await createAndSetFolio(context, programFolio, folioTokenMint.publicKey);

    await createAndSetActor(
      context,
      programFolio,
      folioOwnerKeypair,
      folioPDA,
      Role.Owner
    );
  }

  before(async () => {
    ({ keys, programFolio, provider, context } = await getConnectors());

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
        programFolio,
        folioOwnerKeypair,
        folioPDA,
        null,
        null,
        null,
        null,
        [],
        [],

        true
      );

    beforeEach(async () => {
      await initBaseCase();
    });

    it(`should run ${GeneralTestCases.NotRole}`, async () => {
      await assertNotValidRoleTestCase(
        context,
        programFolio,
        folioOwnerKeypair,
        folioPDA,
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
          tvlFee,
          mintFee,
          auctionDelay,
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
            programFolio,
            folioOwnerKeypair,
            folioPDA,
            tvlFee,
            mintFee,
            auctionDelay,
            auctionLength,
            feeRecipientsToAdd,
            feeRecipientsToRemove
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

            assert.equal(folio.tvlFee.eq(tvlFee), true);
            assert.equal(folio.mintFee.eq(mintFee), true);
            assert.equal(folio.auctionDelay.eq(auctionDelay), true);
            assert.equal(folio.auctionLength.eq(auctionLength), true);

            const feeRecipients =
              await programFolio.account.feeRecipients.fetch(
                getTVLFeeRecipientsPDA(folioPDA)
              );

            const expectedFeeRecipients = buildExpectedArray(
              preAddedRecipients,
              feeRecipientsToAdd,
              feeRecipientsToRemove,
              MAX_FEE_RECIPIENTS,
              {
                recipient: PublicKey.default,
                portion: new BN(0),
              },
              (feeRecipient) =>
                !feeRecipientsToRemove.some((pk) =>
                  pk.equals(feeRecipient.recipient)
                )
            );

            for (let i = 0; i < MAX_FEE_RECIPIENTS; i++) {
              assert.equal(
                feeRecipients.feeRecipients[i].recipient.toString(),
                expectedFeeRecipients[i].recipient.toString()
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
