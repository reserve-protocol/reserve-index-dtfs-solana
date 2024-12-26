import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
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
import {
  getComputeLimitInstruction,
  pSendAndConfirmTxn,
} from "./program-helper";
import {
  getActorPDA,
  getCommunityPDA,
  getFolioPDA,
  getFolioPendingTokenAmountsPDA,
  getFolioSignerPDA,
  getProgramDataPDA,
  getProgramRegistrarPDA,
  getUserPendingTokenAmountsPDA,
} from "./pda-helper";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  buildRemainingAccounts,
  DEFAULT_PRECISION,
  getAtaAddress,
  getOrCreateAtaAddress,
} from "./token-helper";
import { DTF_PROGRAM_ID } from "./pda-helper";

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

export async function initOrUpdateCommunity(
  connection: Connection,
  adminKeypair: Keypair,
  communityReceiver: PublicKey
) {
  const folioProgram = getFolioProgram(connection, adminKeypair);

  const initCommunity = await folioProgram.methods
    .initOrUpdateCommunity()
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
      admin: adminKeypair.publicKey,
      community: getCommunityPDA(),
      communityReceiver: communityReceiver,
    })
    .instruction();

  await pSendAndConfirmTxn(folioProgram, [initCommunity], [], {
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
  feePerSecond: BN
): Promise<{ folioTokenMint: Keypair; folioPDA: PublicKey }> {
  const folioProgram = getFolioProgram(connection, folioOwner);

  const folioTokenMint = Keypair.generate();

  let folioPDA = getFolioPDA(folioTokenMint.publicKey);

  const initFolio = await folioProgram.methods
    .initFolio(feePerSecond)
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      folioOwner: folioOwner.publicKey,
      programRegistrar: getProgramRegistrarPDA(),
      folioProgramSigner: getFolioSignerPDA(),
      folio: folioPDA,
      folioTokenMint: folioTokenMint.publicKey,
      folioTokenAccount: await getAtaAddress(
        folioTokenMint.publicKey,
        folioPDA
      ),
      dtfProgram: DTF_PROGRAM_ID,
      dtfProgramData: getProgramDataPDA(DTF_PROGRAM_ID),
      firstOwner: getActorPDA(folioOwner.publicKey, folioPDA),
    })
    .instruction();

  await pSendAndConfirmTxn(folioProgram, [initFolio], [folioTokenMint], {
    skipPreflight: SKIP_PREFLIGHT,
  });

  return { folioTokenMint, folioPDA };
}

export async function initOrAddMintFolioToken(
  connection: Connection,
  userKeypair: Keypair,
  folio: PublicKey,
  tokens: { mint: PublicKey; amount: BN }[]
) {
  const folioProgram = getFolioProgram(connection, userKeypair);

  const initOrAddMintFolioToken = await folioProgram.methods
    .initOrAddMintFolioToken(tokens.map((token) => token.amount))
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
      tokenProgram: TOKEN_PROGRAM_ID,
      user: userKeypair.publicKey,
      folio,
      folioPendingTokenAmounts: getFolioPendingTokenAmountsPDA(folio),
      userPendingTokenAmounts: getUserPendingTokenAmountsPDA(
        userKeypair.publicKey
      ),
    })
    .remainingAccounts(
      await buildRemainingAccounts(
        connection,
        userKeypair,
        tokens,
        userKeypair.publicKey,
        folio
      )
    )
    .instruction();

  await pSendAndConfirmTxn(folioProgram, [initOrAddMintFolioToken], [], {
    skipPreflight: SKIP_PREFLIGHT,
  });
}

export async function removeFromMintFolioToken(
  connection: Connection,
  userKeypair: Keypair,
  folio: PublicKey,
  tokens: { mint: PublicKey; amount: BN }[]
) {
  const folioProgram = getFolioProgram(connection, userKeypair);

  const removeFromMintFolioToken = await folioProgram.methods
    .removeFromMintFolioToken(tokens.map((token) => token.amount))
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      user: userKeypair.publicKey,
      folio,
      folioPendingTokenAmounts: getFolioPendingTokenAmountsPDA(folio),
      userPendingTokenAmounts: getUserPendingTokenAmountsPDA(
        userKeypair.publicKey
      ),
    })
    .remainingAccounts(
      await buildRemainingAccounts(
        connection,
        userKeypair,
        tokens,
        folio,
        userKeypair.publicKey
      )
    )
    .instruction();

  await pSendAndConfirmTxn(folioProgram, [removeFromMintFolioToken], [], {
    skipPreflight: SKIP_PREFLIGHT,
  });
}

export async function mintFolioToken(
  connection: Connection,
  userKeypair: Keypair,
  folio: PublicKey,
  folioTokenMint: PublicKey,
  tokens: { mint: PublicKey; amount: BN }[],
  shares: BN
) {
  const folioProgram = getFolioProgram(connection, userKeypair);

  const mintFolioToken = await folioProgram.methods
    .mintFolioToken(shares)
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      user: userKeypair.publicKey,
      folio,
      folioTokenMint,
      folioPendingTokenAmounts: getFolioPendingTokenAmountsPDA(folio),
      userPendingTokenAmounts: getUserPendingTokenAmountsPDA(
        userKeypair.publicKey
      ),
      userFolioTokenAccount: await getOrCreateAtaAddress(
        connection,
        folioTokenMint,
        userKeypair,
        userKeypair.publicKey
      ),
    })
    .remainingAccounts(
      await buildRemainingAccounts(
        connection,
        userKeypair,
        tokens,
        folio,
        null,
        false
      )
    )
    .instruction();

  await pSendAndConfirmTxn(
    folioProgram,
    [...getComputeLimitInstruction(1_200_000), mintFolioToken],
    [],
    {
      skipPreflight: SKIP_PREFLIGHT,
    },
    true
  );
}
