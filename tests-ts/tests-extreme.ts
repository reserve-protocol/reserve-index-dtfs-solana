import { airdrop, getConnectors } from "../utils/program-helper";
import { BN } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  addToBasket,
  addToPendingBasket,
  initFolio,
  mintFolioToken,
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
} from "../utils/constants";

describe("Extreme Folio Tests", () => {
  let connection: Connection;
  let keys: any;

  let payerKeypair: Keypair;
  let adminKeypair: Keypair;
  let userKeypair: Keypair;

  let folioOwnerKeypair: Keypair;
  let folioTokenMint: Keypair;
  let folioPDA: PublicKey;

  /*
  Tokens that can be included in the folio
  */
  const NUMBER_OF_TOKENS = 16;

  const feeRecipient: PublicKey = Keypair.generate().publicKey;
  const feeRecipientNumerator: BN = new BN("500000000000000000"); //50% in D18

  const tokenMints = Array.from({ length: NUMBER_OF_TOKENS }, () => ({
    mint: Keypair.generate(),
    decimals: Math.floor(Math.random() * 10) + 1,
  }));

  before(async () => {
    ({ connection, keys } = await getConnectors());

    payerKeypair = Keypair.fromSecretKey(Uint8Array.from(keys.payer));
    adminKeypair = Keypair.fromSecretKey(Uint8Array.from(keys.admin));

    folioOwnerKeypair = Keypair.generate();
    userKeypair = Keypair.generate();

    await airdrop(connection, payerKeypair.publicKey, 1000);
    await airdrop(connection, adminKeypair.publicKey, 1000);
    await airdrop(connection, folioOwnerKeypair.publicKey, 1000);
    await airdrop(connection, userKeypair.publicKey, 1000);

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
      "https://test.com"
    );

    // Create the tokens that can be included in the folio
    for (const tokenMint of tokenMints) {
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
    }

    // Add data to folio
    for (let i = 0; i < tokenMints.length; i += 5) {
      const batch = tokenMints.slice(i, i + 5).map((token) => ({
        mint: token.mint.publicKey,
        amount: new BN(100 * 10 ** token.decimals),
      }));

      if (i + 5 < tokenMints.length) {
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
        await addToBasket(
          connection,
          folioOwnerKeypair,
          folioPDA,
          batch,
          new BN(10 * DEFAULT_DECIMALS_MUL),
          folioTokenMint.publicKey
        );
      }
    }

    await setDaoFeeConfig(
      connection,
      adminKeypair,
      feeRecipient,
      feeRecipientNumerator,
      MAX_FEE_FLOOR
    );
  });

  it("should allow user to init mint folio tokens and mint folio tokens with all token mints we have", async () => {
    for (let i = 0; i < tokenMints.length; i += 5) {
      const batch = tokenMints.slice(i, i + 5).map((token) => ({
        mint: token.mint.publicKey,
        amount: new BN(100 * 10 ** token.decimals),
      }));

      await addToPendingBasket(connection, userKeypair, folioPDA, batch);
    }

    await mintFolioToken(
      connection,
      userKeypair,
      folioPDA,
      folioTokenMint.publicKey,
      tokenMints.map((token) => ({
        mint: token.mint.publicKey,
        amount: new BN(0),
      })),
      new BN(3 * DEFAULT_DECIMALS_MUL)
    );
  });
});
