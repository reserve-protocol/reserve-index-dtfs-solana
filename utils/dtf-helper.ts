import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
import { Dtfs } from "../target/types/dtfs";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import idlDtf from "../target/idl/dtfs.json";
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";
import { pSendAndConfirmTxn } from "./program-helper";
import {
  DTF_PROGRAM_ID,
  getActorPDA,
  getProgramDataPDA,
  getProgramRegistrarPDA,
  FOLIO_PROGRAM_ID,
  getDtfSignerPDA,
} from "./pda-helper";
import { Folio } from "../target/types/folio";

let dtfProgram: Program<Dtfs> = null;

export function getDtfProgram(
  connection: Connection,
  wallet: Keypair
): Program<Dtfs> {
  if (!dtfProgram || dtfProgram.provider.publicKey != wallet.publicKey) {
    dtfProgram = new Program<Dtfs>(
      idlDtf as Dtfs,
      new AnchorProvider(
        connection,
        new NodeWallet(wallet),
        AnchorProvider.defaultOptions()
      )
    );
  }

  return dtfProgram;
}

export async function initDtfSigner(
  connection: Connection,
  adminKeypair: Keypair
) {
  const dtfProgram = getDtfProgram(connection, adminKeypair);

  const initDtfProgramSigner = await dtfProgram.methods
    .initDtfSigner()
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
      admin: adminKeypair.publicKey,
      dtfProgramSigner: getDtfSignerPDA(),
    })
    .instruction();

  await pSendAndConfirmTxn(dtfProgram, [initDtfProgramSigner]);
}

export async function resizeFolio(
  connection: Connection,
  folioOwnerKeypair: Keypair,
  folio: PublicKey,
  folioTokenMint: PublicKey,
  newSize: BN
) {
  const dtfProgram = getDtfProgram(connection, folioOwnerKeypair);

  const resizeFolio = await dtfProgram.methods
    .resizeFolio(newSize)
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
      actor: getActorPDA(folioOwnerKeypair.publicKey, folio),
      dtfProgramSigner: getDtfSignerPDA(),
      dtfProgram: DTF_PROGRAM_ID,
      dtfProgramData: getProgramDataPDA(DTF_PROGRAM_ID),
      folioProgram: FOLIO_PROGRAM_ID,
      folio: folio,
      folioTokenMint,
      programRegistrar: getProgramRegistrarPDA(),
    })
    .instruction();

  await pSendAndConfirmTxn(dtfProgram, [resizeFolio], [], {
    skipPreflight: true,
  });
}
