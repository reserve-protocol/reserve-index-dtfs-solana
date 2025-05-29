import {
  airdrop,
  getConnectors,
  pSendAndConfirmTxn,
} from "../utils/program-helper";
import { Folio } from "../target/types/folio";
import { Folio as SecondFolio } from "../target/types/second_folio";
import { BN, Program } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
  addToBasket,
  distributeFees,
  startFolioMigration,
  updateFolio,
} from "../utils/folio-helper";
import * as assert from "assert";

import {
  MAX_AUCTION_LENGTH,
  MAX_TVL_FEE,
  MAX_MINT_FEE,
  DEFAULT_DECIMALS,
  FEE_NUMERATOR,
  MAX_FEE_FLOOR,
  D9,
} from "../utils/constants";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getMint,
  getTokenMetadata,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import {
  initProgramRegistrar,
  setDaoFeeConfig,
  updateProgramRegistrar,
} from "../utils/folio-admin-helper";
import {
  getOrCreateAtaAddress,
  initToken,
  mintToken,
} from "../utils/token-helper";
import {
  getActorPDA,
  getDAOFeeConfigPDA,
  getFolioPDA,
} from "../utils/pda-helper";
import { FolioAdmin } from "../target/types/folio_admin";

describe("Folio Migration Tests 2022", () => {
  let connection: Connection;
  let programFolio: Program<Folio>;
  let programSecondFolio: Program<SecondFolio>;
  let programFolioAdmin: Program<FolioAdmin>;
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

  const feeRecipient: PublicKey = Keypair.generate().publicKey;

  before(async () => {
    ({ connection, programFolio, programSecondFolio, keys, programFolioAdmin } =
      await getConnectors());

    payerKeypair = Keypair.fromSecretKey(Uint8Array.from(keys.payer));
    adminKeypair = Keypair.fromSecretKey(Uint8Array.from(keys.admin));

    folioTokenMint = Keypair.generate();

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
      [programSecondFolio.programId, programFolio.programId],
      false
    );
    folioPDA = getFolioPDA(folioTokenMint.publicKey);

    // Init folio in first instance and add the tokens / initializes it
    const initFolioInstruction = await programFolio.methods
      .initFolio2022(
        MAX_TVL_FEE,
        MAX_MINT_FEE,
        MAX_AUCTION_LENGTH,
        "Test Folio",
        "TFOL",
        "https://test.com",
        "mandate"
      )
      .accountsPartial({
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        folioOwner: folioOwnerKeypair.publicKey,
        folio: folioPDA,
        folioTokenMint: folioTokenMint.publicKey,
        actor: getActorPDA(folioOwnerKeypair.publicKey, folioPDA),
      })
      .instruction();

    await pSendAndConfirmTxn(
      programFolio,
      [initFolioInstruction],
      [folioTokenMint, folioOwnerKeypair],
      {}
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
      folioTokenMint.publicKey,
      TOKEN_2022_PROGRAM_ID
    );

    // Call update folio for creation of fee recipients
    await updateFolio(
      connection,
      folioOwnerKeypair,
      folioPDA,
      folioTokenMint.publicKey,
      feeRecipient,
      null,
      new BN(0),
      null,
      null,
      [],
      [],
      null,
      TOKEN_2022_PROGRAM_ID
    );

    // Set dao fee recipient
    await setDaoFeeConfig(
      connection,
      adminKeypair,
      feeRecipient,
      FEE_NUMERATOR,
      MAX_FEE_FLOOR
    );

    newFolioPDA = getFolioPDA(folioTokenMint.publicKey, true);

    const daoFeeConfig = await programFolioAdmin.account.daoFeeConfig.fetch(
      getDAOFeeConfigPDA()
    );
    const daoFeeRecipientATA = await getOrCreateAtaAddress(
      connection,
      folioTokenMint.publicKey,
      folioOwnerKeypair,
      daoFeeConfig.feeRecipient,
      TOKEN_2022_PROGRAM_ID
    );

    // Poke folio and distribute fees.
    await distributeFees(
      connection,
      folioOwnerKeypair,
      folioPDA,
      folioTokenMint.publicKey,
      daoFeeRecipientATA,
      new BN(1),
      TOKEN_2022_PROGRAM_ID
    );
  });

  // This does not work because the folio basket is not created
  // To test this properly and to migration properly we need `init_folio_for_migration` instruction in the new folio program
  // I will implement this in with feature flags similar to `UpdateBasketInNewFolioProgram and `MintFromNewFolioProgram`
  // And then we can test this properly in the amman version
  it("should allow user to migrate from first to second instance", async () => {
    const mintInfoBefore = await getMint(
      connection,
      folioTokenMint.publicKey,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    const tokenMetadataBefore = await getTokenMetadata(
      connection,
      folioTokenMint.publicKey,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    // Now migrate from first to second instance
    await startFolioMigration(
      connection,
      folioOwnerKeypair,
      folioTokenMint.publicKey,
      folioPDA,
      newFolioPDA,
      programSecondFolio.programId,
      new BN(D9),
      TOKEN_2022_PROGRAM_ID
    );

    const oldFolioAccountAfter = await programFolio.account.folio.fetch(
      folioPDA
    );
    const mintInfoAfter = await getMint(
      connection,
      folioTokenMint.publicKey,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

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
    const tokenMetadataAfter = await getTokenMetadata(
      connection,
      folioTokenMint.publicKey,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    assert.equal(tokenMetadataBefore.updateAuthority?.equals(folioPDA), true);
    assert.equal(tokenMetadataAfter.updateAuthority?.equals(newFolioPDA), true);
  });
});
