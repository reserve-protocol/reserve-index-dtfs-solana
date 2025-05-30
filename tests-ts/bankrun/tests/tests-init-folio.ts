import { BN, Program } from "@coral-xyz/anchor";
import { BankrunProvider } from "anchor-bankrun";
import { Keypair } from "@solana/web3.js";
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

import { getActorPDA, getFolioPDA } from "../../../utils/pda-helper";
import { initFolio } from "../bankrun-ix-helper";
import * as assert from "assert";
import {
  MAX_TVL_FEE,
  MAX_MINT_FEE,
  MIN_AUCTION_LENGTH,
  MAX_PADDED_STRING_LENGTH,
} from "../../../utils/constants";
import { MAX_AUCTION_LENGTH } from "../../../utils/constants";

/**
 * Tests for folio initialization functionality, including:
 * - Creating new folios
 * - Setting initial parameters (fees, delays, lengths)
 * - Mandate validation
 * - Owner role assignment
 * - Parameter boundary validation
 */

describe("Bankrun - Init Folio", () => {
  let context: ProgramTestContext;
  let provider: BankrunProvider;
  let banksClient: BanksClient;

  let programFolio: Program<Folio>;

  let keys: any;

  let payerKeypair: Keypair;
  let adminKeypair: Keypair;
  let userKeypair: Keypair;

  let folioOwnerKeypair: Keypair;

  const DEFAULT_PARAMS: {
    tvlFee: BN;
    mintFee: BN;
    auctionLength: BN;
    name: string;
    symbol: string;
    uri: string;
    mandate: string;
  } = {
    tvlFee: MAX_TVL_FEE,
    mintFee: MAX_MINT_FEE,
    auctionLength: MAX_AUCTION_LENGTH,
    name: "Test Folio",
    symbol: "TFOL",
    uri: "https://test.com",
    mandate: "mandate",
  };

  const TEST_CASES = [
    {
      desc: "(folio fee too high)",
      tvlFee: MAX_TVL_FEE.add(new BN(1)),
      expectedError: "TVLFeeTooHigh",
    },
    {
      desc: "(test minting fee too high)",
      mintFee: MAX_MINT_FEE.add(new BN(1)),
      expectedError: "InvalidMintFee",
    },
    {
      desc: "(auction length too low)",
      auctionLength: MIN_AUCTION_LENGTH.sub(new BN(1)),
      expectedError: "InvalidAuctionLength",
    },
    {
      desc: "(auction length too high)",
      auctionLength: MAX_AUCTION_LENGTH.add(new BN(1)),
      expectedError: "InvalidAuctionLength",
    },
    {
      desc: "(mandate too long)",
      mandate: "a".repeat(MAX_PADDED_STRING_LENGTH + 1),
      expectedError: "InvalidMandateLength",
    },
    {
      desc: "(valid creation)",
      expectedError: null,
    },
  ];

  before(async () => {
    ({ keys, programFolio, provider, context } = await getConnectors());

    banksClient = context.banksClient;

    payerKeypair = provider.wallet.payer;

    adminKeypair = Keypair.fromSecretKey(Uint8Array.from(keys.admin));

    folioOwnerKeypair = Keypair.generate();
    userKeypair = Keypair.generate();

    await airdrop(context, payerKeypair.publicKey, 1000);
    await airdrop(context, adminKeypair.publicKey, 1000);
    await airdrop(context, folioOwnerKeypair.publicKey, 1000);
    await airdrop(context, userKeypair.publicKey, 1000);
  });

  describe("Specific Cases - Init Folio", () => {
    TEST_CASES.forEach(({ desc, expectedError, ...restOfParams }) => {
      describe(`When ${desc}`, () => {
        let txnResult: BanksTransactionResultWithMeta;
        let folioTokenMint: Keypair;

        before(async () => {
          folioTokenMint = Keypair.generate();

          txnResult = await initFolio<true>(
            banksClient,
            programFolio,
            folioOwnerKeypair,
            folioTokenMint,
            { ...DEFAULT_PARAMS, ...restOfParams } // @ts-ignore
          );
        });

        if (expectedError) {
          it("should fail with expected error", () => {
            assertError(txnResult, expectedError);
          });
        } else {
          it("should succeed", async () => {
            await travelFutureSlot(context);

            const folioPDA = getFolioPDA(folioTokenMint.publicKey);

            const folio = await programFolio.account.folio.fetch(folioPDA);

            assert.notEqual(folio.bump, 0);
            // should be ~3.34e-9 * 1e18, but with estimation we accept the 0.1% error rate for this max value
            assert.equal(folio.tvlFee.eq(new BN("3334813116")), true);
            assert.equal(folio.mintFee.eq(MAX_MINT_FEE), true);
            assert.deepEqual(folio.folioTokenMint, folioTokenMint.publicKey);
            assert.equal(folio.auctionLength.eq(MAX_AUCTION_LENGTH), true);

            const ownerActorPDA = getActorPDA(
              folioOwnerKeypair.publicKey,
              folioPDA
            );

            const ownerActor = await programFolio.account.actor.fetch(
              ownerActorPDA
            );

            assert.notEqual(ownerActor.bump, 0);
            assert.deepEqual(ownerActor.authority, folioOwnerKeypair.publicKey);
          });
        }
      });
    });
  });
});
