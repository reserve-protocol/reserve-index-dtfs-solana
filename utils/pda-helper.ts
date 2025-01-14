import { PublicKey } from "@solana/web3.js";
import idlFolio from "../target/idl/folio.json";
import idlDtfs from "../target/idl/dtfs.json";
import BN from "bn.js";

export const DTF_PROGRAM_ID = new PublicKey(idlDtfs.address);
export const FOLIO_PROGRAM_ID = new PublicKey(idlFolio.address);
export const BPF_LOADER_PROGRAM_ID = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111"
);

export const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

export function getFolioSignerPDA() {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("folio_program_signer")],
    FOLIO_PROGRAM_ID
  )[0];
}

export function getProgramRegistrarPDA() {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("program_registrar")],
    FOLIO_PROGRAM_ID
  )[0];
}

export function getFolioPDA(folioTokenMint: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("folio"), folioTokenMint.toBuffer()],
    FOLIO_PROGRAM_ID
  )[0];
}

export function getActorPDA(authority: PublicKey, folioPDA: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("actor"), authority.toBuffer(), folioPDA.toBuffer()],
    FOLIO_PROGRAM_ID
  )[0];
}

export function getProgramDataPDA(programId: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [programId.toBuffer()],
    BPF_LOADER_PROGRAM_ID
  )[0];
}

export function getDtfSignerPDA() {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("dtf_program_signer")],
    DTF_PROGRAM_ID
  )[0];
}

export function getDAOFeeConfigPDA() {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("dao_fee_config")],
    DTF_PROGRAM_ID
  )[0];
}

export function getFolioFeeRecipientsPDA(folio: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("fee_recipients"), folio.toBuffer()],
    FOLIO_PROGRAM_ID
  )[0];
}

export function getFolioPendingBasketPDA(folio: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pending_basket"), folio.toBuffer()],
    FOLIO_PROGRAM_ID
  )[0];
}

export function getUserPendingBasketPDA(folio: PublicKey, user: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pending_basket"), folio.toBuffer(), user.toBuffer()],
    FOLIO_PROGRAM_ID
  )[0];
}

export function getMetadataPDA(mint: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ],
    TOKEN_METADATA_PROGRAM_ID
  )[0];
}

export function getFeeDistributionPDA(folio: PublicKey, index: BN) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("fee_distribution"),
      folio.toBuffer(),
      index.toBuffer("le", 8),
    ],
    FOLIO_PROGRAM_ID
  )[0];
}

export function getTradePDA(folio: PublicKey, tradeId: BN) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("trade"), folio.toBuffer(), tradeId.toBuffer("le", 8)],
    FOLIO_PROGRAM_ID
  )[0];
}
