import { PublicKey } from "@solana/web3.js";
import idlFolio from "../target/idl/folio.json";
import idlDtfs from "../target/idl/dtfs.json";

export const DTF_PROGRAM_ID = new PublicKey(idlDtfs.address);
export const FOLIO_PROGRAM_ID = new PublicKey(idlFolio.address);
export const BPF_LOADER_PROGRAM_ID = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111"
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
    DTF_PROGRAM_ID
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

export function getCommunityPDA() {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("community")],
    FOLIO_PROGRAM_ID
  )[0];
}
