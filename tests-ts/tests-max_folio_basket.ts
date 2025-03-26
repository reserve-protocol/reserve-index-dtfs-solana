import { airdrop, getConnectors } from "../utils/program-helper";
import { BN, Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  addOrUpdateActor,
  addToBasket,
  addToPendingBasket,
  approveAuction,
  initFolio,
  mintFolioToken,
  openAuction,
} from "../utils/folio-helper";
import { setDaoFeeConfig } from "../utils/folio-admin-helper";
import { initToken, mintToken } from "../utils/token-helper";
import {
  MAX_AUCTION_DELAY,
  MAX_TVL_FEE,
  MIN_AUCTION_LENGTH,
  DEFAULT_DECIMALS_MUL,
  MAX_MINT_FEE,
  MAX_FEE_FLOOR,
  MAX_TOKENS_IN_BASKET,
  FEE_NUMERATOR,
  MAX_TTL,
} from "../utils/constants";
import { Folio } from "../target/types/folio";
import { getAuctionPDA, getFolioBasketPDA } from "../utils/pda-helper";
import { assert } from "chai";

describe("Max tokens in basket", () => {
  let connection: Connection;
  let programFolio: Program<Folio>;
  let keys: any;

  let payerKeypair: Keypair;
  let adminKeypair: Keypair;
  let userKeypair: Keypair;

  let folioOwnerKeypair: Keypair;
  let folioTokenMint: Keypair;
  let folioPDA: PublicKey;
  let auctionApproverKeypair: Keypair;

  const BATCH_SIZE = 5;

  const feeRecipient: PublicKey = Keypair.generate().publicKey;

  const tokenMints = Array.from({ length: 100 }, () => ({
    mint: Keypair.generate(),
    // To test with different token decimals
    decimals: 9,
  }));

  before(async () => {
    ({ connection, programFolio, keys } = await getConnectors());

    payerKeypair = Keypair.fromSecretKey(Uint8Array.from(keys.payer));
    adminKeypair = Keypair.fromSecretKey(Uint8Array.from(keys.admin));

    folioOwnerKeypair = Keypair.generate();
    userKeypair = Keypair.generate();
    auctionApproverKeypair = Keypair.generate();

    await airdrop(connection, payerKeypair.publicKey, 1000);
    await airdrop(connection, adminKeypair.publicKey, 1000);
    await airdrop(connection, folioOwnerKeypair.publicKey, 1000);
    await airdrop(connection, userKeypair.publicKey, 1000);
    await airdrop(connection, auctionApproverKeypair.publicKey, 1000);

    folioTokenMint = Keypair.generate();

    // Init folio related accounts
    folioPDA = await initFolio(
      connection,
      folioOwnerKeypair,
      folioTokenMint,
      MAX_TVL_FEE,
      MAX_MINT_FEE,
      MAX_AUCTION_DELAY,
      MIN_AUCTION_LENGTH,
      "Test Folio",
      "TFOL",
      "https://test.com",
      "mandate"
    );

    // Create the tokens that can be included in the folio
    // Process tokens in batches of 100
    for (let i = 0; i < tokenMints.length; i += 100) {
      const batch = tokenMints.slice(i, Math.min(i + 100, tokenMints.length));
      await Promise.all(
        batch.map(async (tokenMint) => {
          await initToken(
            connection,
            adminKeypair,
            tokenMint.mint,
            tokenMint.decimals // to test different decimals
          );
          await mintToken(
            connection,
            adminKeypair,
            tokenMint.mint.publicKey,
            1_000,
            folioOwnerKeypair.publicKey
          );

          await mintToken(
            connection,
            adminKeypair,
            tokenMint.mint.publicKey,
            1_000,
            userKeypair.publicKey
          );
          console.log(tokenMint.mint.publicKey.toBase58());
        })
      );
      console.log(
        `Processed batch ${i / 100 + 1} of ${Math.ceil(
          tokenMints.length / 100
        )}`
      );
    }

    // Add tokens to the folio basket
    for (let i = 0; i < tokenMints.length; i += BATCH_SIZE) {
      const batch = tokenMints.slice(i, i + BATCH_SIZE).map((token) => ({
        mint: token.mint.publicKey,
        amount: new BN(100 * 10 ** token.decimals),
      }));

      if (i + BATCH_SIZE < tokenMints.length) {
        await addToBasket(
          connection,
          folioOwnerKeypair,
          folioPDA,
          batch,
          null,
          folioTokenMint.publicKey
        );
      } else {
        //10 shares, mint decimals for folio token is 9
        // await addToBasket(
        //   connection,
        //   folioOwnerKeypair,
        //   folioPDA,
        //   batch,
        //   new BN(10 * DEFAULT_DECIMALS_MUL),
        //   folioTokenMint.publicKey
        // );
      }
      console.log(i);
    }

    // const batches = [];

    // // Process tokens in batches of 100 for addToBasket
    // for (let i = 0; i < tokenMints.length - BATCH_SIZE; i += BATCH_SIZE) {
    //   const batch = tokenMints.slice(i, i + BATCH_SIZE).map((token) => ({
    //     mint: token.mint.publicKey,
    //     amount: new BN(100 * 10 ** token.decimals),
    //   }));

    //   // Process each batch of 100 tokens in sub-batches of 10
    //   const subBatches = [];
    //   for (let j = 0; j < batch.length; j += 10) {
    //     const subBatch = batch.slice(j, j + 10);
    //     subBatches.push(
    //       addToBasket(
    //         connection,
    //         folioOwnerKeypair,
    //         folioPDA,
    //         subBatch,
    //         null,
    //         folioTokenMint.publicKey
    //       )
    //     );
    //   }

    //   // Wait for all sub-batches to complete before moving to next batch
    //   await Promise.all(subBatches);
    //   console.log(`Processed batch ${i / BATCH_SIZE + 1}`);
    // }

    // await Promise.all(batches);

    // // Handle the last batch separately
    // const lastBatch = tokenMints.slice(-BATCH_SIZE).map((token) => ({
    //   mint: token.mint.publicKey,
    //   amount: new BN(100 * 10 ** token.decimals),
    // }));

    // //10 shares, mint decimals for folio token is 9
    // await addToBasket(
    //   connection,
    //   folioOwnerKeypair,
    //   folioPDA,
    //   lastBatch,
    //   new BN(10 * DEFAULT_DECIMALS_MUL),
    //   folioTokenMint.publicKey
    // );

    await setDaoFeeConfig(
      connection,
      adminKeypair,
      feeRecipient,
      FEE_NUMERATOR,
      MAX_FEE_FLOOR
    );
  });

  it("should allow user to init his pending basket and mint folio tokens with all token mints we have", async () => {
    const folioBasketPda = getFolioBasketPDA(folioPDA);
    const folioBasket = await programFolio.account.folioBasket.fetch(
      folioBasketPda
    );
    console.log(
      folioBasket.tokenAmounts.filter(
        (token) => token.mint !== PublicKey.default
      ).length
    );
    // for (let i = 0; i < tokenMints.length; i += BATCH_SIZE) {
    //   const batch = tokenMints.slice(i, i + BATCH_SIZE).map((token) => ({
    //     mint: token.mint.publicKey,
    //     amount: new BN(100 * 10 ** token.decimals),
    //   }));

    //   await addToPendingBasket(connection, userKeypair, folioPDA, batch);
    // }

    // await mintFolioToken(
    //   connection,
    //   userKeypair,
    //   folioPDA,
    //   folioTokenMint.publicKey,
    //   tokenMints.map((token) => ({
    //     mint: token.mint.publicKey,
    //     amount: new BN(0),
    //   })),
    //   new BN(3 * DEFAULT_DECIMALS_MUL)
    // );
  });
});
