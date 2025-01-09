import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { Folio } from "../target/types/folio";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import idlFolio from "../target/idl/folio.json";
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";
import { pSendAndConfirmTxn } from "./program-helper";
import {
  getActorPDA,
  getFolioPDA,
  getFolioSignerPDA,
  getProgramDataPDA,
  getProgramRegistrarPDA,
} from "./pda-helper";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { DTF_PROGRAM_ID } from "./pda-helper";
import { DecimalValue } from "./decimal-util";

let folioProgram: Program<Folio> = null;

const SKIP_PREFLIGHT = true;

export function getFolioProgram(
  connection: Connection,
  wallet: Keypair
): Program<Folio> {
  if (!folioProgram || folioProgram.provider.publicKey != wallet.publicKey) {
    folioProgram = new Program<Folio>(
      idlFolio as Folio,
      new AnchorProvider(
        connection,
        new NodeWallet(wallet),
        AnchorProvider.defaultOptions()
      )
    );
  }

  return folioProgram;
}

export async function initFolioSigner(
  connection: Connection,
  adminKeypair: Keypair
) {
  const folioProgram = getFolioProgram(connection, adminKeypair);

  const folioSigner =
    await folioProgram.account.folioProgramSigner.fetchNullable(
      getFolioSignerPDA()
    );

  if (folioSigner) {
    return;
  }

  const initFolioSigner = await folioProgram.methods
    .initFolioSigner()
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
      admin: adminKeypair.publicKey,
      folioProgramSigner: getFolioSignerPDA(),
    })
    .instruction();

  await pSendAndConfirmTxn(folioProgram, [initFolioSigner], [], {
    skipPreflight: SKIP_PREFLIGHT,
  });
}

export async function initProgramRegistrar(
  connection: Connection,
  adminKeypair: Keypair,
  dtfAcceptedProgramId: PublicKey
) {
  const folioProgram = getFolioProgram(connection, adminKeypair);

  const programRegistrar =
    await folioProgram.account.programRegistrar.fetchNullable(
      getProgramRegistrarPDA()
    );

  if (programRegistrar) {
    return;
  }

  const registerProgram = await folioProgram.methods
    .initProgramRegistrar(dtfAcceptedProgramId)
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
      admin: adminKeypair.publicKey,
      programRegistrar: getProgramRegistrarPDA(),
    })
    .instruction();

  await pSendAndConfirmTxn(folioProgram, [registerProgram], [], {
    skipPreflight: SKIP_PREFLIGHT,
  });
}
export async function updateProgramRegistrar(
  connection: Connection,
  adminKeypair: Keypair,
  dtfProgramIds: PublicKey[],
  toRemove: boolean
) {
  const folioProgram = getFolioProgram(connection, adminKeypair);

  const updateProgramRegistrar = await folioProgram.methods
    .updateProgramRegistrar(dtfProgramIds, toRemove)
    .accountsPartial({
      admin: adminKeypair.publicKey,
      programRegistrar: getProgramRegistrarPDA(),
    })
    .instruction();

  await pSendAndConfirmTxn(folioProgram, [updateProgramRegistrar], [], {
    skipPreflight: SKIP_PREFLIGHT,
  });
}

export async function initFolio(
  connection: Connection,
  folioOwner: Keypair,
  folioFee: DecimalValue,
  mintingFee: DecimalValue
): Promise<{ folioTokenMint: Keypair; folioPDA: PublicKey }> {
  const folioProgram = getFolioProgram(connection, folioOwner);

  const folioTokenMint = Keypair.generate();

  let folioPDA = getFolioPDA(folioTokenMint.publicKey);

  const initFolio = await folioProgram.methods
    .initFolio(folioFee, mintingFee)
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      folioOwner: folioOwner.publicKey,
      programRegistrar: getProgramRegistrarPDA(),
      folio: folioPDA,
      folioTokenMint: folioTokenMint.publicKey,
      dtfProgram: DTF_PROGRAM_ID,
      dtfProgramData: getProgramDataPDA(DTF_PROGRAM_ID),
      actor: getActorPDA(folioOwner.publicKey, folioPDA),
    })
    .instruction();

  await pSendAndConfirmTxn(folioProgram, [initFolio], [folioTokenMint], {
    skipPreflight: SKIP_PREFLIGHT,
  });

  return { folioTokenMint, folioPDA };
}
