import { createAndProcessTransaction } from "./bankrun-program-helper";
import { Dtfs } from "../../target/types/dtfs";
import {
  getActorPDA,
  getDAOFeeConfigPDA,
  getDtfSignerPDA,
  getFolioPDA,
  getFolioSignerPDA,
  getMetadataPDA,
  getProgramDataPDA,
  getProgramRegistrarPDA,
  TOKEN_METADATA_PROGRAM_ID,
} from "../../utils/pda-helper";
import { PublicKey, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { SystemProgram } from "@solana/web3.js";
import { BN, Program } from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";
import { BanksClient } from "solana-bankrun";
import { ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Folio } from "../../target/types/folio";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

/*
DTF Directly
*/
export async function initDtfSigner(
  client: BanksClient,
  programDtf: Program<Dtfs>,
  adminKeypair: Keypair
) {
  const ix = await programDtf.methods
    .initDtfSigner()
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
      admin: adminKeypair.publicKey,
      dtfProgramSigner: getDtfSignerPDA(),
    })
    .instruction();

  return createAndProcessTransaction(client, adminKeypair, [ix]);
}

export async function setDaoFeeConfig(
  client: BanksClient,
  programDtf: Program<Dtfs>,
  adminKeypair: Keypair,
  feeRecipient: PublicKey,
  feeRecipientNumerator: BN
) {
  const ix = await programDtf.methods
    .setDaoFeeConfig(feeRecipient, feeRecipientNumerator)
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
      admin: adminKeypair.publicKey,
      daoFeeConfig: getDAOFeeConfigPDA(),
    })
    .instruction();

  return createAndProcessTransaction(client, adminKeypair, [ix]);
}

/*
Through Folio directly
*/
export async function initFolioSigner(
  client: BanksClient,
  programFolio: Program<Folio>,
  adminKeypair: Keypair
) {
  const ix = await programFolio.methods
    .initFolioSigner()
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
      admin: adminKeypair.publicKey,
      folioProgramSigner: getFolioSignerPDA(),
    })
    .instruction();

  return createAndProcessTransaction(client, adminKeypair, [ix]);
}

export async function initProgramRegistrar(
  client: BanksClient,
  programFolio: Program<Folio>,
  adminKeypair: Keypair,
  dtfAcceptedProgramId: PublicKey
) {
  const registerProgram = await programFolio.methods
    .initProgramRegistrar(dtfAcceptedProgramId)
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
      admin: adminKeypair.publicKey,
      programRegistrar: getProgramRegistrarPDA(),
    })
    .instruction();

  return createAndProcessTransaction(client, adminKeypair, [registerProgram]);
}

export async function updateProgramRegistrar(
  client: BanksClient,
  programFolio: Program<Folio>,
  adminKeypair: Keypair,
  dtfProgramIds: PublicKey[],
  toRemove: boolean
) {
  const updateProgramRegistrar = await programFolio.methods
    .updateProgramRegistrar(dtfProgramIds, toRemove)
    .accountsPartial({
      admin: adminKeypair.publicKey,
      programRegistrar: getProgramRegistrarPDA(),
    })
    .instruction();

  return createAndProcessTransaction(client, adminKeypair, [
    updateProgramRegistrar,
  ]);
}

export async function initFolio(
  client: BanksClient,
  programFolio: Program<Folio>,
  folioOwner: Keypair,
  folioTokenMint: Keypair,
  dtfProgramId: PublicKey,
  params: {
    folioFee: BN;
    mintingFee: BN;
    tradeDelay: BN;
    auctionLength: BN;
    name: string;
    symbol: string;
    uri: string;
  }
) {
  let folioPDA = getFolioPDA(folioTokenMint.publicKey);

  const initFolio = await programFolio.methods
    .initFolio(
      params.folioFee,
      params.mintingFee,
      params.tradeDelay,
      params.auctionLength,
      params.name,
      params.symbol,
      params.uri
    )
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      folioOwner: folioOwner.publicKey,
      programRegistrar: getProgramRegistrarPDA(),
      folio: folioPDA,
      folioTokenMint: folioTokenMint.publicKey,
      dtfProgram: dtfProgramId,
      dtfProgramData: getProgramDataPDA(dtfProgramId),
      actor: getActorPDA(folioOwner.publicKey, folioPDA),
      tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
      metadata: getMetadataPDA(folioTokenMint.publicKey),
    })
    .instruction();

  return createAndProcessTransaction(
    client,
    folioOwner,
    [initFolio],
    [folioTokenMint]
  );
}

/*
Through DTF proxy
*/
