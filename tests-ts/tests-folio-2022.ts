import {
  airdrop,
  getConnectors,
  pSendAndConfirmTxn,
} from "../utils/program-helper";
import { Folio } from "../target/types/folio";
import { Program } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import { getFolioProgram } from "../utils/folio-helper";
import * as assert from "assert";

import {
  getActorPDA,
  getFolioPDA,
  getTVLFeeRecipientsPDA,
} from "../utils/pda-helper";
import {
  MAX_AUCTION_LENGTH,
  MAX_AUCTION_DELAY,
  MAX_MINT_FEE,
  EXPECTED_TVL_FEE_WHEN_MAX,
  MAX_TVL_FEE,
} from "../utils/constants";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getTokenMetadata,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";

/**
 * Tests for the Folio program with SPL 2022.
 */

describe("Folio Tests", () => {
  let connection: Connection;
  let programFolio: Program<Folio>;
  let keys: any;

  let payerKeypair: Keypair;
  let adminKeypair: Keypair;

  let folioOwnerKeypair: Keypair;
  let folioTokenMint: Keypair;

  before(async () => {
    ({ connection, programFolio, keys } = await getConnectors());

    payerKeypair = Keypair.fromSecretKey(Uint8Array.from(keys.payer));
    adminKeypair = Keypair.fromSecretKey(Uint8Array.from(keys.admin));

    folioTokenMint = Keypair.generate();

    folioOwnerKeypair = Keypair.generate();

    await airdrop(connection, payerKeypair.publicKey, 1000);
    await airdrop(connection, adminKeypair.publicKey, 1000);
    await airdrop(connection, folioOwnerKeypair.publicKey, 1000);
  });

  it("should initialize a folio with SPL 2022", async () => {
    const folioProgram = getFolioProgram(connection, folioOwnerKeypair);
    const folioPDA = getFolioPDA(folioTokenMint.publicKey);

    const initFolio = await folioProgram.methods
      .initFolio2022(
        MAX_TVL_FEE,
        MAX_MINT_FEE,
        MAX_AUCTION_DELAY,
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

    await pSendAndConfirmTxn(folioProgram, [initFolio], [folioTokenMint], {});

    const folio = await programFolio.account.folio.fetch(folioPDA);

    const feeRecipients =
      await programFolio.account.feeRecipients.fetchNullable(
        getTVLFeeRecipientsPDA(folioPDA)
      );

    assert.notEqual(folio.bump, 0);
    assert.equal(folio.tvlFee.eq(EXPECTED_TVL_FEE_WHEN_MAX), true);
    assert.equal(folio.mintFee.eq(MAX_MINT_FEE), true);
    assert.deepEqual(folio.folioTokenMint, folioTokenMint.publicKey);
    assert.equal(feeRecipients, null);
    assert.equal(folio.auctionDelay.eq(MAX_AUCTION_DELAY), true);
    assert.equal(folio.auctionLength.eq(MAX_AUCTION_LENGTH), true);

    const ownerActorPDA = getActorPDA(folioOwnerKeypair.publicKey, folioPDA);

    const ownerActor = await programFolio.account.actor.fetch(ownerActorPDA);

    assert.notEqual(ownerActor.bump, 0);
    assert.deepEqual(ownerActor.authority, folioOwnerKeypair.publicKey);

    // Validate metadata for spl 2022
    const { name, symbol, uri } = await getTokenMetadata(
      connection,
      folioTokenMint.publicKey
    );

    assert.equal(name, "Test Folio");
    assert.equal(symbol, "TFOL");
    assert.equal(uri, "https://test.com");
  });
});
