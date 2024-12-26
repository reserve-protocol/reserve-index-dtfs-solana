import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
import { Dtfs } from "../target/types/dtfs";
import {
  AccountMeta,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import idlDtf from "../target/idl/dtfs.json";
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";
import {
  getComputeLimitInstruction,
  pSendAndConfirmTxn,
} from "./program-helper";
import {
  DTF_PROGRAM_ID,
  getActorPDA,
  getProgramDataPDA,
  getProgramRegistrarPDA,
  FOLIO_PROGRAM_ID,
  getDtfSignerPDA,
  getFolioFeeRecipientsPDA,
  getFolioPendingTokenAmountsPDA,
} from "./pda-helper";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { buildRemainingAccounts } from "./token-helper";

let dtfProgram: Program<Dtfs> = null;

const SKIP_PREFLIGHT = true;

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

  const dtfSigner = await dtfProgram.account.dtfProgramSigner.fetchNullable(
    getDtfSignerPDA()
  );

  if (dtfSigner) {
    return;
  }

  const initDtfProgramSigner = await dtfProgram.methods
    .initDtfSigner()
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
      admin: adminKeypair.publicKey,
      dtfProgramSigner: getDtfSignerPDA(),
    })
    .instruction();

  await pSendAndConfirmTxn(dtfProgram, [initDtfProgramSigner], [], {
    skipPreflight: SKIP_PREFLIGHT,
  });
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
      folioOwner: folioOwnerKeypair.publicKey,
      actor: getActorPDA(folioOwnerKeypair.publicKey, folio),
      dtfProgramSigner: getDtfSignerPDA(),
      dtfProgram: DTF_PROGRAM_ID,
      dtfProgramData: getProgramDataPDA(DTF_PROGRAM_ID),
      folioProgram: FOLIO_PROGRAM_ID,
      folio: folio,
      programRegistrar: getProgramRegistrarPDA(),
    })
    .instruction();

  await pSendAndConfirmTxn(dtfProgram, [resizeFolio], [], {
    skipPreflight: SKIP_PREFLIGHT,
  });
}

export async function updateFolio(
  connection: Connection,
  folioOwnerKeypair: Keypair,
  folio: PublicKey,
  folioTokenMint: PublicKey,
  programVersion: PublicKey | null,
  programDeploymentSlot: BN | null,
  feePerSecond: BN | null,
  feeRecipientsToAdd: { receiver: PublicKey; share: BN }[],
  feeRecipientsToRemove: PublicKey[]
) {
  const dtfProgram = getDtfProgram(connection, folioOwnerKeypair);

  const updateFolio = await dtfProgram.methods
    .updateFolio(
      programVersion,
      programDeploymentSlot,
      feePerSecond,
      feeRecipientsToAdd,
      feeRecipientsToRemove
    )
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
      actor: getActorPDA(folioOwnerKeypair.publicKey, folio),
      dtfProgramSigner: getDtfSignerPDA(),
      dtfProgram: DTF_PROGRAM_ID,
      dtfProgramData: getProgramDataPDA(DTF_PROGRAM_ID),
      folioProgram: FOLIO_PROGRAM_ID,
      folio: folio,
      folioFeeRecipients: getFolioFeeRecipientsPDA(folio),
      programRegistrar: getProgramRegistrarPDA(),
    })
    .instruction();

  await pSendAndConfirmTxn(
    dtfProgram,
    [...getComputeLimitInstruction(), updateFolio],
    [],
    {
      skipPreflight: SKIP_PREFLIGHT,
    }
  );
}

export async function addOrUpdateActor(
  connection: Connection,
  folioOwnerKeypair: Keypair,
  folio: PublicKey,
  folioTokenMint: PublicKey,
  newActorAuthority: PublicKey,
  role: any = { priceCurator: {} }
) {
  const dtfProgram = getDtfProgram(connection, folioOwnerKeypair);

  const addOrUpdateActor = await dtfProgram.methods
    .initOrUpdateActor(role)
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
      folioOwner: folioOwnerKeypair.publicKey,
      newActorAuthority: newActorAuthority,
      folioOwnerActor: getActorPDA(folioOwnerKeypair.publicKey, folio),
      newActor: getActorPDA(newActorAuthority, folio),
      dtfProgramSigner: getDtfSignerPDA(),
      dtfProgram: DTF_PROGRAM_ID,
      dtfProgramData: getProgramDataPDA(DTF_PROGRAM_ID),
      folioProgram: FOLIO_PROGRAM_ID,
      folio: folio,
      programRegistrar: getProgramRegistrarPDA(),
    })
    .instruction();

  await pSendAndConfirmTxn(dtfProgram, [addOrUpdateActor], [], {
    skipPreflight: SKIP_PREFLIGHT,
  });
}

export async function removeActor(
  connection: Connection,
  folioOwnerKeypair: Keypair,
  folio: PublicKey,
  folioTokenMint: PublicKey,
  actorAuthority: PublicKey,
  role: any = { priceCurator: {} },
  closeActor: boolean
) {
  const dtfProgram = getDtfProgram(connection, folioOwnerKeypair);

  const removeActor = await dtfProgram.methods
    .removeActor(role, closeActor)
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
      folioOwner: folioOwnerKeypair.publicKey,
      actorAuthority: actorAuthority,
      folioOwnerActor: getActorPDA(folioOwnerKeypair.publicKey, folio),
      actorToRemove: getActorPDA(actorAuthority, folio),
      dtfProgramSigner: getDtfSignerPDA(),
      dtfProgram: DTF_PROGRAM_ID,
      dtfProgramData: getProgramDataPDA(DTF_PROGRAM_ID),
      folioProgram: FOLIO_PROGRAM_ID,
      folio: folio,
      programRegistrar: getProgramRegistrarPDA(),
    })
    .instruction();

  await pSendAndConfirmTxn(dtfProgram, [removeActor], [], {
    skipPreflight: SKIP_PREFLIGHT,
  });
}

export async function addTokensToFolio(
  connection: Connection,
  folioOwnerKeypair: Keypair,
  folio: PublicKey,
  folioTokenMint: PublicKey,
  tokens: { mint: PublicKey; amount: BN }[]
) {
  const dtfProgram = getDtfProgram(connection, folioOwnerKeypair);

  const addTokensToFolio = await dtfProgram.methods
    .addTokensToFolio()
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      folioOwner: folioOwnerKeypair.publicKey,
      actor: getActorPDA(folioOwnerKeypair.publicKey, folio),
      dtfProgramSigner: getDtfSignerPDA(),
      dtfProgram: DTF_PROGRAM_ID,
      dtfProgramData: getProgramDataPDA(DTF_PROGRAM_ID),
      folioProgram: FOLIO_PROGRAM_ID,
      folio: folio,
      folioPendingTokenAmounts: getFolioPendingTokenAmountsPDA(folio),
      programRegistrar: getProgramRegistrarPDA(),
    })
    .remainingAccounts(
      await buildRemainingAccounts(
        connection,
        folioOwnerKeypair,
        tokens,
        null,
        null
      )
    )
    .instruction();

  await pSendAndConfirmTxn(dtfProgram, [addTokensToFolio], [], {
    skipPreflight: SKIP_PREFLIGHT,
  });
}

export async function finalizeFolio(
  connection: Connection,
  folioOwnerKeypair: Keypair,
  folio: PublicKey,
  folioTokenMint: PublicKey
) {
  const dtfProgram = getDtfProgram(connection, folioOwnerKeypair);

  const finalizeFolio = await dtfProgram.methods
    .finalizeFolio()
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      folioOwner: folioOwnerKeypair.publicKey,
      actor: getActorPDA(folioOwnerKeypair.publicKey, folio),
      dtfProgramSigner: getDtfSignerPDA(),
      dtfProgram: DTF_PROGRAM_ID,
      dtfProgramData: getProgramDataPDA(DTF_PROGRAM_ID),
      folioProgram: FOLIO_PROGRAM_ID,
      folio: folio,
      programRegistrar: getProgramRegistrarPDA(),
    })
    .instruction();

  await pSendAndConfirmTxn(dtfProgram, [finalizeFolio], [], {
    skipPreflight: SKIP_PREFLIGHT,
  });
}
