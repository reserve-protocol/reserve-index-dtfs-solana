import { BN, Program, Provider } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  airdrop,
  assertError,
  BanksTransactionResultWithMeta,
  buildExpectedArray,
  getConnectors,
  travelFutureSlot,
} from "../bankrun-program-helper";

import {
  getTVLFeeRecipientsPDA,
  getFolioPDA,
  getFeeDistributionPDA,
} from "../../../utils/pda-helper";
import { updateFolio } from "../bankrun-ix-helper";
import {
  createAndSetFolio,
  Role,
  createAndSetActor,
  FeeRecipient,
  createAndSetFeeRecipients,
  createAndSetDaoFeeConfig,
  closeAccount,
} from "../bankrun-account-helper";
import { Folio } from "../../../target/types/folio";
import {
  assertNotValidRoleTestCase,
  GeneralTestCases,
} from "../bankrun-general-tests-helper";

import * as assert from "assert";
import {
  EXPECTED_TVL_FEE_WHEN_MAX,
  MAX_FEE_RECIPIENTS,
  MAX_PADDED_STRING_LENGTH,
  MAX_MINT_FEE,
  MIN_AUCTION_LENGTH,
  TOTAL_PORTION_FEE_RECIPIENT,
} from "../../../utils/constants";
import { MAX_AUCTION_LENGTH } from "../../../utils/constants";
import { MAX_TVL_FEE } from "../../../utils/constants";
import { FolioAdmin } from "../../../target/types/folio_admin";
import { initToken } from "../bankrun-token-helper";
import { LiteSVM } from "litesvm";

/**
 * Tests for folio update functionality, including:
 * - Updating folio parameters (fees, delays, lengths)
 * - Updating fee recipients
 * - Mandate updates
 * - Permission validation
 * - Parameter boundary checks
 */
describe("Bankrun - Update Folio", () => {
  let context: LiteSVM;
  let provider: Provider;
  let banksClient: LiteSVM;

  let programFolio: Program<Folio>;
  let programFolioAdmin: Program<FolioAdmin>;

  let keys: any;

  let payerKeypair: Keypair;
  let adminKeypair: Keypair;

  let folioOwnerKeypair: Keypair;

  let folioTokenMint: Keypair;

  let folioPDA: PublicKey;

  const FEE_PORTION_SUM = new BN("1000000000000000000"); //1e18
  const EQUAL_PORTION = FEE_PORTION_SUM.div(new BN(MAX_FEE_RECIPIENTS));

  const FEE_RECIPIENT_KEYPAIR = Keypair.generate();

  const DEFAULT_PARAMS: {
    tvlFee: BN;
    mintFee: BN;
    auctionLength: BN;
    mandate: string;
    preAddedRecipients: FeeRecipient[];
    feeRecipientsToAdd: FeeRecipient[];
    feeRecipientsToRemove: PublicKey[];
    feeRecipientAccountAlreadyExists: boolean;
  } = {
    tvlFee: MAX_TVL_FEE,
    mintFee: MAX_MINT_FEE,
    auctionLength: MAX_AUCTION_LENGTH,
    mandate: "a".repeat(MAX_PADDED_STRING_LENGTH),
    preAddedRecipients: [],
    feeRecipientsToAdd: [],
    feeRecipientsToRemove: [],
    feeRecipientAccountAlreadyExists: true,
  };

  const TEST_CASES = [
    {
      desc: "(should update folio fee, fee too high)",
      tvlFee: MAX_TVL_FEE.add(new BN(1)),
      expectedError: "TVLFeeTooHigh",
    },
    {
      desc: "(should update folio fee, success)",
      tvlFee: MAX_TVL_FEE.sub(new BN(1)),
      expectedError: null,
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
      preAddedRecipients: [
        new FeeRecipient(Keypair.generate().publicKey, EQUAL_PORTION),
        new FeeRecipient(
          FEE_RECIPIENT_KEYPAIR.publicKey,
          TOTAL_PORTION_FEE_RECIPIENT.sub(EQUAL_PORTION)
        ),
      ],
      feeRecipientsToAdd: [
        new FeeRecipient(
          Keypair.generate().publicKey,
          TOTAL_PORTION_FEE_RECIPIENT.sub(EQUAL_PORTION)
        ),
      ],
      feeRecipientsToRemove: [FEE_RECIPIENT_KEYPAIR.publicKey],
      expectedError: null,
    },
    {
      desc: "(should update fee recipients, remove and add same one) and create fee recipient in updateFolio",
      preAddedRecipients: [],
      feeRecipientsToAdd: [
        new FeeRecipient(FEE_RECIPIENT_KEYPAIR.publicKey, FEE_PORTION_SUM),
      ],
      feeRecipientsToRemove: [],
      expectedError: null,
      feeRecipientAccountAlreadyExists: false,
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
      preAddedRecipients: Array(MAX_FEE_RECIPIENTS - 1)
        .map(() => {
          return new FeeRecipient(PublicKey.default, new BN(0));
        })
        .concat([
          new FeeRecipient(
            FEE_RECIPIENT_KEYPAIR.publicKey,
            FEE_PORTION_SUM.sub(new BN(2))
          ),
        ]),
      feeRecipientsToAdd: [
        new FeeRecipient(FEE_RECIPIENT_KEYPAIR.publicKey, new BN(1)),
      ],
      feeRecipientsToRemove: [],
      expectedError: "InvalidFeeRecipientPortion",
    },
    {
      desc: "(should update mandate, too long)",
      mandate: "a".repeat(MAX_PADDED_STRING_LENGTH + 1),
      expectedError: "InvalidMandateLength",
    },
    {
      desc: "(should update mandate, success)",
      mandate: "a".repeat(MAX_PADDED_STRING_LENGTH),
      expectedError: null,
    },
    {
      desc: "(should fail, if fee recipient pubkey is repeated)",
      preAddedRecipients: [
        new FeeRecipient(FEE_RECIPIENT_KEYPAIR.publicKey, FEE_PORTION_SUM),
      ],
      feeRecipientsToAdd: [
        new FeeRecipient(
          FEE_RECIPIENT_KEYPAIR.publicKey,
          TOTAL_PORTION_FEE_RECIPIENT.sub(FEE_PORTION_SUM)
        ),
      ],
      feeRecipientsToRemove: [],
      expectedError: "InvalidFeeRecipientContainsDuplicates",
    },
  ];

  async function initBaseCase() {
    await createAndSetDaoFeeConfig(
      context,
      programFolioAdmin,
      FEE_RECIPIENT_KEYPAIR.publicKey,
      new BN(1)
    );

    await createAndSetFolio(context, programFolio, folioTokenMint.publicKey);

    await createAndSetActor(
      context,
      programFolio,
      folioOwnerKeypair,
      folioPDA,
      Role.Owner
    );

    initToken(context, folioPDA, folioTokenMint.publicKey);

    closeAccount(context, getFeeDistributionPDA(folioPDA, new BN(1)));
  }

  beforeEach(async () => {
    ({ keys, programFolio, programFolioAdmin, provider, context } =
      await getConnectors());

    banksClient = context;

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
        context,
        banksClient,
        programFolio,
        folioOwnerKeypair,
        folioPDA,
        folioTokenMint.publicKey,
        FEE_RECIPIENT_KEYPAIR.publicKey,
        null,
        null,
        null,
        null,
        [],
        [],
        null,
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

  describe("Specific Cases - Update Folio", () => {
    TEST_CASES.forEach(({ desc, expectedError, ...restOfParams }) => {
      describe(`When ${desc}`, () => {
        let txnResult: BanksTransactionResultWithMeta;
        const {
          tvlFee,
          mintFee,
          auctionLength,
          feeRecipientsToAdd,
          feeRecipientsToRemove,
          preAddedRecipients,
          mandate,
          feeRecipientAccountAlreadyExists,
        } = { ...DEFAULT_PARAMS, ...restOfParams };

        let folioTvlFeeBefore: BN;

        beforeEach(async () => {
          await initBaseCase();

          if (feeRecipientAccountAlreadyExists) {
            await createAndSetFeeRecipients(
              context,
              programFolio,
              folioPDA,
              preAddedRecipients
            );
          } else {
            // We delete account so, one test is not affected by the other.
            closeAccount(context, getTVLFeeRecipientsPDA(folioPDA));
          }

          await travelFutureSlot(context);

          folioTvlFeeBefore = (await programFolio.account.folio.fetch(folioPDA))
            .tvlFee;

          txnResult = await updateFolio<true>(
            context,
            banksClient,
            programFolio,
            folioOwnerKeypair,
            folioPDA,
            folioTokenMint.publicKey,
            FEE_RECIPIENT_KEYPAIR.publicKey,
            tvlFee,
            new BN(1),
            mintFee,
            auctionLength,
            feeRecipientsToAdd,
            feeRecipientsToRemove,
            mandate
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

            if (!folioTvlFeeBefore.eq(folio.tvlFee)) {
              // Only check if the tvlFee is different
              assert.equal(folio.tvlFee.eq(EXPECTED_TVL_FEE_WHEN_MAX), true);
            }

            assert.equal(folio.mintFee.eq(mintFee), true);
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
