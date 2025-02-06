import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import idlFolioAdmin from "../target/idl/folio_admin.json";
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";
import { pSendAndConfirmTxn } from "./program-helper";
import { getProgramRegistrarPDA, getDAOFeeConfigPDA } from "./pda-helper";
import { FolioAdmin } from "../target/types/folio_admin";

let folioAdminProgram: Program<FolioAdmin> = null;

const SKIP_PREFLIGHT = true;

export function getFolioAdminProgram(
  connection: Connection,
  wallet: Keypair
): Program<FolioAdmin> {
  if (
    !folioAdminProgram ||
    folioAdminProgram.provider.publicKey != wallet.publicKey
  ) {
    folioAdminProgram = new Program<FolioAdmin>(
      idlFolioAdmin as FolioAdmin,
      new AnchorProvider(
        connection,
        new NodeWallet(wallet),
        AnchorProvider.defaultOptions()
      )
    );
  }

  return folioAdminProgram;
}

export async function setDaoFeeConfig(
  connection: Connection,
  adminKeypair: Keypair,
  feeRecipient: PublicKey,
  feeRecipientNumerator: BN
) {
  const folioAdminProgram = getFolioAdminProgram(connection, adminKeypair);

  const setDaoFeeConfig = await folioAdminProgram.methods
    .setDaoFeeConfig(feeRecipient, feeRecipientNumerator)
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
      admin: adminKeypair.publicKey,
      daoFeeConfig: getDAOFeeConfigPDA(),
    })
    .instruction();

  await pSendAndConfirmTxn(folioAdminProgram, [setDaoFeeConfig], [], {
    skipPreflight: SKIP_PREFLIGHT,
  });
}

export async function initProgramRegistrar(
  connection: Connection,
  adminKeypair: Keypair,
  folioAcceptedProgramId: PublicKey
) {
  const folioAdminProgram = getFolioAdminProgram(connection, adminKeypair);

  const programRegistrar =
    await folioAdminProgram.account.programRegistrar.fetchNullable(
      getProgramRegistrarPDA()
    );

  if (programRegistrar) {
    return;
  }

  const registerProgram = await folioAdminProgram.methods
    .initProgramRegistrar(folioAcceptedProgramId)
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
      admin: adminKeypair.publicKey,
      programRegistrar: getProgramRegistrarPDA(),
    })
    .instruction();

  await pSendAndConfirmTxn(folioAdminProgram, [registerProgram], [], {
    skipPreflight: SKIP_PREFLIGHT,
  });
}

export async function updateProgramRegistrar(
  connection: Connection,
  adminKeypair: Keypair,
  folioProgramIds: PublicKey[],
  toRemove: boolean
) {
  const folioAdminProgram = getFolioAdminProgram(connection, adminKeypair);

  const updateProgramRegistrar = await folioAdminProgram.methods
    .updateProgramRegistrar(folioProgramIds, toRemove)
    .accountsPartial({
      admin: adminKeypair.publicKey,
      programRegistrar: getProgramRegistrarPDA(),
    })
    .instruction();

  await pSendAndConfirmTxn(folioAdminProgram, [updateProgramRegistrar], [], {
    skipPreflight: SKIP_PREFLIGHT,
  });
}
