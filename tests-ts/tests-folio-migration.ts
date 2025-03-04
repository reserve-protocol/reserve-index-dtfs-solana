import { airdrop, getConnectors } from "../utils/program-helper";
import { Folio } from "../target/types/folio";
import { Folio as SecondFolio } from "../target/types/second_folio";
import { BN, Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  addToBasket,
  initFolio,
  migrateFolioTokens,
  startFolioMigration,
} from "../utils/folio-helper";
import * as assert from "assert";

import {
  MAX_AUCTION_LENGTH,
  MAX_TVL_FEE,
  MAX_AUCTION_DELAY,
  MAX_MINT_FEE,
  DEFAULT_DECIMALS,
} from "../utils/constants";
import { getMint } from "@solana/spl-token";
import {
  initProgramRegistrar,
  updateProgramRegistrar,
} from "../utils/folio-admin-helper";
import {
  getOrCreateAtaAddress,
  getTokenBalance,
  initToken,
  mintToken,
} from "../utils/token-helper";

describe("Folio Migration Tests", () => {
  let connection: Connection;
  let programFolio: Program<Folio>;
  let programSecondFolio: Program<SecondFolio>;
  let keys: any;

  let payerKeypair: Keypair;
  let adminKeypair: Keypair;

  let folioOwnerKeypair: Keypair;
  let folioTokenMint: Keypair;
  let folioPDA: PublicKey;

  const tokenMints = [
    { mint: Keypair.generate(), decimals: DEFAULT_DECIMALS },
    { mint: Keypair.generate(), decimals: DEFAULT_DECIMALS },
  ];

  // Folio in the second instance
  let newFolioPDA: PublicKey;

  // Here we use another mint just for initializing the second folio in the second instance (since the code) inits the folio mint
  // in future folio program version this won't be the case.
  let otherFolioTokenMint: Keypair;

  before(async () => {
    ({ connection, programFolio, programSecondFolio, keys } =
      await getConnectors());

    payerKeypair = Keypair.fromSecretKey(Uint8Array.from(keys.payer));
    adminKeypair = Keypair.fromSecretKey(Uint8Array.from(keys.admin));

    folioTokenMint = Keypair.generate();
    otherFolioTokenMint = Keypair.generate();

    folioOwnerKeypair = Keypair.generate();

    await airdrop(connection, payerKeypair.publicKey, 1000);
    await airdrop(connection, adminKeypair.publicKey, 1000);
    await airdrop(connection, folioOwnerKeypair.publicKey, 1000);

    for (const tokenMint of tokenMints) {
      await initToken(
        connection,
        adminKeypair,
        tokenMint.mint,
        tokenMint.decimals
      );
      await mintToken(
        connection,
        adminKeypair,
        tokenMint.mint.publicKey,
        1_000,
        folioOwnerKeypair.publicKey
      );
    }

    // Add both programs to the program registrar
    await initProgramRegistrar(
      connection,
      adminKeypair,
      programFolio.programId
    );

    await updateProgramRegistrar(
      connection,
      adminKeypair,
      [programSecondFolio.programId],
      false
    );

    // Init folio in first instance and add the tokens / initializes it
    folioPDA = await initFolio(
      connection,
      folioOwnerKeypair,
      folioTokenMint,
      MAX_TVL_FEE,
      MAX_MINT_FEE,
      MAX_AUCTION_DELAY,
      MAX_AUCTION_LENGTH,
      "Test Folio",
      "TFOL",
      "https://test.com",
      "mandate"
    );

    await addToBasket(
      connection,
      folioOwnerKeypair,
      folioPDA,
      [
        {
          mint: tokenMints[0].mint.publicKey,
          amount: new BN(100 * 10 ** tokenMints[0].decimals),
        },
        {
          mint: tokenMints[1].mint.publicKey,
          amount: new BN(200 * 10 ** tokenMints[1].decimals),
        },
      ],
      new BN(1000),
      folioTokenMint.publicKey
    );

    // Init folio in second instance
    newFolioPDA = await initFolio(
      connection,
      folioOwnerKeypair,
      otherFolioTokenMint,
      MAX_TVL_FEE,
      MAX_MINT_FEE,
      MAX_AUCTION_DELAY,
      MAX_AUCTION_LENGTH,
      "Test Folio",
      "TFOL",
      "https://test.com",
      "mandate",
      true
    );
  });

  it("should allow user to migrate from first to second instance", async () => {
    const mintInfoBefore = await getMint(connection, folioTokenMint.publicKey);

    // Now migrate from first to second instance
    await startFolioMigration(
      connection,
      folioOwnerKeypair,
      folioTokenMint.publicKey,
      folioPDA,
      newFolioPDA,
      programSecondFolio.programId
    );

    const oldFolioAccountAfter = await programFolio.account.folio.fetch(
      folioPDA
    );
    const mintInfoAfter = await getMint(connection, folioTokenMint.publicKey);

    // Migrating status
    assert.equal(oldFolioAccountAfter.status, 3);

    // Authorities should have been updated
    assert.equal(mintInfoBefore.mintAuthority.toBase58(), folioPDA.toBase58());
    assert.equal(
      mintInfoAfter.mintAuthority.toBase58(),
      newFolioPDA.toBase58()
    );

    assert.equal(
      mintInfoBefore.freezeAuthority.toBase58(),
      folioPDA.toBase58()
    );
    assert.equal(
      mintInfoAfter.freezeAuthority.toBase58(),
      newFolioPDA.toBase58()
    );
  });

  it("should allow user to transfer tokens from first to second folio", async () => {
    const tokenBalancesOldFolioBefore: { mint: PublicKey; amount: BN }[] = [];
    const tokenBalancesOldFolioAfter: { mint: PublicKey; amount: BN }[] = [];

    const tokenBalancesNewFolioBefore: { mint: PublicKey; amount: BN }[] = [];
    const tokenBalancesNewFolioAfter: { mint: PublicKey; amount: BN }[] = [];

    for (const tokenMint of tokenMints) {
      tokenBalancesOldFolioBefore.push({
        mint: tokenMint.mint.publicKey,
        amount: new BN(
          await getTokenBalance(
            connection,
            await getOrCreateAtaAddress(
              connection,
              tokenMint.mint.publicKey,
              payerKeypair,
              folioPDA
            )
          )
        ),
      });

      tokenBalancesNewFolioBefore.push({
        mint: tokenMint.mint.publicKey,
        amount: new BN(
          await getTokenBalance(
            connection,
            await getOrCreateAtaAddress(
              connection,
              tokenMint.mint.publicKey,
              payerKeypair,
              newFolioPDA
            )
          )
        ),
      });
    }

    await migrateFolioTokens(
      connection,
      payerKeypair, // Can be anyone
      folioPDA,
      newFolioPDA,
      programSecondFolio.programId,
      folioTokenMint.publicKey,
      tokenMints.map((t) => t.mint.publicKey)
    );

    for (const tokenMint of tokenMints) {
      tokenBalancesOldFolioAfter.push({
        mint: tokenMint.mint.publicKey,
        amount: new BN(
          await getTokenBalance(
            connection,
            await getOrCreateAtaAddress(
              connection,
              tokenMint.mint.publicKey,
              payerKeypair,
              folioPDA
            )
          )
        ),
      });

      tokenBalancesNewFolioAfter.push({
        mint: tokenMint.mint.publicKey,
        amount: new BN(
          await getTokenBalance(
            connection,
            await getOrCreateAtaAddress(
              connection,
              tokenMint.mint.publicKey,
              payerKeypair,
              newFolioPDA
            )
          )
        ),
      });
    }

    // Switched the tokens
    assert.deepEqual(tokenBalancesOldFolioBefore, tokenBalancesNewFolioAfter);
    assert.deepEqual(tokenBalancesNewFolioBefore, tokenBalancesOldFolioAfter);
  });
});
