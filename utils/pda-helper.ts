import { PublicKey } from "@solana/web3.js";
import idlFolio from "../target/idl/folio.json";
import idlDtfs from "../target/idl/dtfs.json";

export const DTF_PROGRAM_ID = new PublicKey(idlDtfs.address);
export const FOLIO_PROGRAM_ID = new PublicKey(idlFolio.address);

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

export function getActorPDA(authority: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("actor"), authority.toBuffer()],
    DTF_PROGRAM_ID
  )[0];
}
