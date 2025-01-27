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
  mockDTFProgramData,
} from "../bankrun-program-helper";
import { getProgramNotInRegistrarTestCase } from "../bankrun-general-tests-helper";
import {
  MAX_AUCTION_LENGTH,
  MAX_FOLIO_FEE,
  MIN_DAO_MINTING_FEE,
} from "../../../utils/dtf-helper";
import { MAX_TRADE_DELAY } from "../../../utils/dtf-helper";
import {
  DTF_PROGRAM_ID,
  getActorPDA,
  getFolioPDA,
} from "../../../utils/pda-helper";
import { initFolio, initProgramRegistrar } from "../bankrun-ix-helper";
import * as assert from "assert";

describe("Bankrun - Init folio", () => {
  let context: ProgramTestContext;
  let provider: BankrunProvider;
  let banksClient: BanksClient;

  let programFolio: Program<Folio>;

  let keys: any;

  let payerKeypair: Keypair;
  let adminKeypair: Keypair;
  let userKeypair: Keypair;

  let folioOwnerKeypair: Keypair;

  const defaultParams = {
    folioFee: new BN("500000000000000000"),
    mintingFee: new BN("500000000000000"),
    tradeDelay: MAX_TRADE_DELAY,
    auctionLength: MAX_AUCTION_LENGTH,
    name: "Test Folio",
    symbol: "TFOL",
    uri: "https://test.com",
  };

  const testCases = [
    getProgramNotInRegistrarTestCase(),
    {
      desc: "(folio fee too high)",
      folioFee: new BN("500000000000000000").add(new BN(1)),
      expectedError: "InvalidFeePerSecond",
    },
    {
      desc: "(minting fee too low)",
      mintingFee: new BN("499999999999999"),
      expectedError: "InvalidMintingFee",
    },
    {
      desc: "(test minting fee too high)",
      mintingFee: new BN("10000000000000000000"),
      expectedError: "InvalidMintingFee",
    },
    {
      desc: "(trade delay too high)",
      tradeDelay: new BN(604800 + 1),
      expectedError: "InvalidTradeDelay",
    },
    {
      desc: "(auction length too low)",
      auctionLength: new BN(59),
      expectedError: "InvalidAuctionLength",
    },
    {
      desc: "(auction length too high)",
      auctionLength: new BN(604800 + 1),
      expectedError: "InvalidAuctionLength",
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

    // Init
    await initProgramRegistrar(
      banksClient,
      programFolio,
      adminKeypair,
      DTF_PROGRAM_ID
    );

    await mockDTFProgramData(
      context,
      DTF_PROGRAM_ID,
      adminKeypair.publicKey,
      1
    );
  });

  testCases.forEach(({ desc, expectedError, ...restOfParams }) => {
    describe(`When ${desc}`, () => {
      let txnResult: BanksTransactionResultWithMeta;
      let folioTokenMint: Keypair;

      before(async () => {
        folioTokenMint = Keypair.generate();

        txnResult = await initFolio(
          banksClient,
          programFolio,
          folioOwnerKeypair,
          folioTokenMint,
          restOfParams["dtfProgramId"] || DTF_PROGRAM_ID,
          // @ts-ignore
          { ...defaultParams, ...restOfParams }
        );
      });

      if (expectedError) {
        it("should fail with expected error", () => {
          assertError(txnResult, expectedError);
        });
      } else {
        it("should succeed", async () => {
          const folioPDA = getFolioPDA(folioTokenMint.publicKey);

          const folio = await programFolio.account.folio.fetch(folioPDA);

          assert.notEqual(folio.bump, 0);
          assert.equal(folio.folioFee.eq(MAX_FOLIO_FEE), true);
          assert.equal(folio.mintingFee.eq(MIN_DAO_MINTING_FEE), true);
          assert.deepEqual(folio.programVersion, DTF_PROGRAM_ID);
          assert.deepEqual(folio.folioTokenMint, folioTokenMint.publicKey);
          assert.equal(folio.tradeDelay.eq(MAX_TRADE_DELAY), true);
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
