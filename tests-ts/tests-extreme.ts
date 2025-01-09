import { airdrop, getConnectors } from "../utils/program-helper";
import { BN } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  initFolio,
  initFolioSigner,
  initProgramRegistrar,
} from "../utils/folio-helper";
import { DTF_PROGRAM_ID } from "../utils/pda-helper";
import {
  addToBasket,
  finalizeBasket,
  initDtfSigner,
  addToPendingBasket,
  mintFolioToken,
  MAX_FOLIO_FEE,
  MIN_DAO_MINTING_FEE,
} from "../utils/dtf-helper";
import {
  DEFAULT_DECIMALS_MUL,
  initToken,
  mintToken,
} from "../utils/token-helper";

describe("Extrme DTFs Tests", () => {
  let connection: Connection;
  let keys: any;

  let payerKeypair: Keypair;
  let adminKeypair: Keypair;
  let userKeypair: Keypair;

  let folioOwnerKeypair: Keypair;
  let folioTokenMint: Keypair;
  let folioPDA: PublicKey;

  // let folioTestHelper: TestHelper;

  /*
  Tokens that can be included in the folio
  */
  const NUMBER_OF_TOKENS = 16;

  let tokenMints = Array.from({ length: NUMBER_OF_TOKENS }, () => ({
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

    // Init folio related accounts
    await initFolioSigner(connection, payerKeypair);
    await initProgramRegistrar(connection, adminKeypair, DTF_PROGRAM_ID);
    ({ folioTokenMint, folioPDA } = await initFolio(
      connection,
      folioOwnerKeypair,
      MAX_FOLIO_FEE,
      MIN_DAO_MINTING_FEE
    ));

    // Init dtf related accounts
    await initDtfSigner(connection, adminKeypair);

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

      await addToBasket(connection, folioOwnerKeypair, folioPDA, batch);
    }

    await finalizeBasket(
      connection,
      folioOwnerKeypair,
      folioPDA,
      folioTokenMint.publicKey,
      new BN(10 * DEFAULT_DECIMALS_MUL) //10 shares, mint decimals for folio token is 9
    );

    // folioTestHelper = new TestHelper(
    //   connection,
    //   payerKeypair,
    //   program,
    //   folioPDA,
    //   folioTokenMint.publicKey,
    //   userKeypair.publicKey,
    //   tokenMints
    // );
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
