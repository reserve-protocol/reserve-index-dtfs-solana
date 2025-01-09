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
  getFolioPendingBasketPDA,
  getUserPendingBasketPDA,
  getDAOFeeConfigPDA,
} from "./pda-helper";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  buildRemainingAccounts,
  getAtaAddress,
  getOrCreateAtaAddress,
} from "./token-helper";
import { DecimalValue } from "./decimal-util";

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

export async function setDaoFeeConfig(
  connection: Connection,
  adminKeypair: Keypair,
  feeRecipient: PublicKey,
  feeRecipientNumerator: DecimalValue
) {
  const dtfProgram = getDtfProgram(connection, adminKeypair);

  const setDaoFeeConfig = await dtfProgram.methods
    .setDaoFeeConfig(feeRecipient, feeRecipientNumerator)
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
      admin: adminKeypair.publicKey,
      daoFeeConfig: getDAOFeeConfigPDA(),
    })
    .instruction();

  await pSendAndConfirmTxn(dtfProgram, [setDaoFeeConfig], [], {
    skipPreflight: SKIP_PREFLIGHT,
  });
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
  programVersion: PublicKey | null,
  programDeploymentSlot: BN | null,
  folioFee: DecimalValue | null,
  mintingFee: DecimalValue | null,
  feeRecipientsToAdd: { receiver: PublicKey; portion: BN }[],
  feeRecipientsToRemove: PublicKey[]
) {
  const dtfProgram = getDtfProgram(connection, folioOwnerKeypair);

  const folioFeeDecimals =
    folioFee === null
      ? null
      : { whole: folioFee.whole, fractional: folioFee.fractional };

  const mintingFeeDecimals =
    mintingFee === null
      ? null
      : { whole: mintingFee.whole, fractional: mintingFee.fractional };

  const feeRecipientsToAddDecimals = feeRecipientsToAdd.map((feeRecipient) => ({
    receiver: feeRecipient.receiver,
    portion: { whole: new BN(0), fractional: feeRecipient.portion },
  }));

  const updateFolio = await dtfProgram.methods
    .updateFolio(
      programVersion,
      programDeploymentSlot,
      folioFeeDecimals,
      mintingFeeDecimals,
      feeRecipientsToAddDecimals,
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
      feeRecipients: getFolioFeeRecipientsPDA(folio),
      programRegistrar: getProgramRegistrarPDA(),
    })
    .instruction();

  await pSendAndConfirmTxn(
    dtfProgram,
    [...getComputeLimitInstruction(600_000), updateFolio],
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

export async function addToBasket(
  connection: Connection,
  folioOwnerKeypair: Keypair,
  folio: PublicKey,
  tokens: { mint: PublicKey; amount: BN }[]
) {
  const dtfProgram = getDtfProgram(connection, folioOwnerKeypair);

  const addToBasket = await dtfProgram.methods
    .addToBasket(tokens.map((token) => token.amount))
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      folioOwner: folioOwnerKeypair.publicKey,
      actor: getActorPDA(folioOwnerKeypair.publicKey, folio),
      dtfProgramSigner: getDtfSignerPDA(),
      dtfProgram: DTF_PROGRAM_ID,
      dtfProgramData: getProgramDataPDA(DTF_PROGRAM_ID),
      folioProgram: FOLIO_PROGRAM_ID,
      folio: folio,
      folioPendingBasket: getFolioPendingBasketPDA(folio),
      programRegistrar: getProgramRegistrarPDA(),
    })
    .remainingAccounts(
      await buildRemainingAccounts(
        connection,
        folioOwnerKeypair,
        tokens,
        folioOwnerKeypair.publicKey,
        folio
      )
    )
    .instruction();

  await pSendAndConfirmTxn(dtfProgram, [addToBasket], [], {
    skipPreflight: SKIP_PREFLIGHT,
  });
}

export async function finalizeBasket(
  connection: Connection,
  folioOwnerKeypair: Keypair,
  folio: PublicKey,
  folioTokenMint: PublicKey,
  initialShares: BN
) {
  const dtfProgram = getDtfProgram(connection, folioOwnerKeypair);

  const finalizeBasket = await dtfProgram.methods
    .finalizeBasket(initialShares)
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
      folioTokenMint,
      folioTokenAccount: await getAtaAddress(folioTokenMint, folio),
      programRegistrar: getProgramRegistrarPDA(),
      ownerFolioTokenAccount: await getOrCreateAtaAddress(
        connection,
        folioTokenMint,
        folioOwnerKeypair,
        folioOwnerKeypair.publicKey
      ),
    })
    .instruction();

  await pSendAndConfirmTxn(dtfProgram, [finalizeBasket], [], {
    skipPreflight: SKIP_PREFLIGHT,
  });
}

export async function addToPendingBasket(
  connection: Connection,
  userKeypair: Keypair,
  folio: PublicKey,
  tokens: { mint: PublicKey; amount: BN }[]
) {
  const dtfProgram = getDtfProgram(connection, userKeypair);

  const addToPendingBasket = await dtfProgram.methods
    .addToPendingBasket(tokens.map((token) => token.amount))
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
      tokenProgram: TOKEN_PROGRAM_ID,
      user: userKeypair.publicKey,
      programRegistrar: getProgramRegistrarPDA(),
      folio,
      folioPendingBasket: getFolioPendingBasketPDA(folio),
      userPendingBasket: getUserPendingBasketPDA(folio, userKeypair.publicKey),
      folioProgram: FOLIO_PROGRAM_ID,
      dtfProgramSigner: getDtfSignerPDA(),
      dtfProgram: DTF_PROGRAM_ID,
      dtfProgramData: getProgramDataPDA(DTF_PROGRAM_ID),
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

  await pSendAndConfirmTxn(dtfProgram, [addToPendingBasket], [], {
    skipPreflight: SKIP_PREFLIGHT,
  });
}

export async function removeFromPendingBasket(
  connection: Connection,
  userKeypair: Keypair,
  folio: PublicKey,
  tokens: { mint: PublicKey; amount: BN }[]
) {
  const dtfProgram = getDtfProgram(connection, userKeypair);

  const removeFromPendingBasket = await dtfProgram.methods
    .removeFromPendingBasket(tokens.map((token) => token.amount))
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,

      user: userKeypair.publicKey,
      programRegistrar: getProgramRegistrarPDA(),
      folio,
      folioPendingBasket: getFolioPendingBasketPDA(folio),
      userPendingBasket: getUserPendingBasketPDA(folio, userKeypair.publicKey),
      folioProgram: FOLIO_PROGRAM_ID,
      dtfProgramSigner: getDtfSignerPDA(),
      dtfProgram: DTF_PROGRAM_ID,
      dtfProgramData: getProgramDataPDA(DTF_PROGRAM_ID),
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

  await pSendAndConfirmTxn(dtfProgram, [removeFromPendingBasket], [], {
    skipPreflight: SKIP_PREFLIGHT,
  });
}

export async function mintFolioToken(
  connection: Connection,
  userKeypair: Keypair,
  folio: PublicKey,
  folioTokenMint: PublicKey,
  tokens: { mint: PublicKey; amount: BN }[],
  shares: DecimalValue
) {
  const dtfProgram = getDtfProgram(connection, userKeypair);
  const mintFolioToken = await dtfProgram.methods
    .mintFolioToken({ whole: shares.whole, fractional: shares.fractional })
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      user: userKeypair.publicKey,
      programRegistrar: getProgramRegistrarPDA(),
      folio,
      folioTokenMint,
      folioPendingBasket: getFolioPendingBasketPDA(folio),
      userPendingBasket: getUserPendingBasketPDA(folio, userKeypair.publicKey),
      userFolioTokenAccount: await getOrCreateAtaAddress(
        connection,
        folioTokenMint,
        userKeypair,
        userKeypair.publicKey
      ),
      dtfProgramSigner: getDtfSignerPDA(),
      dtfProgram: DTF_PROGRAM_ID,
      dtfProgramData: getProgramDataPDA(DTF_PROGRAM_ID),
      folioProgram: FOLIO_PROGRAM_ID,
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
    dtfProgram,
    [...getComputeLimitInstruction(1_200_000), mintFolioToken],
    [],
    {
      skipPreflight: SKIP_PREFLIGHT,
    },
    true
  );
}

export async function burnFolioToken(
  connection: Connection,
  userKeypair: Keypair,
  folio: PublicKey,
  folioTokenMint: PublicKey,
  amountToBurn: DecimalValue,
  tokens: { mint: PublicKey; amount: BN }[]
) {
  const dtfProgram = getDtfProgram(connection, userKeypair);

  const burnFolioTokenIx = await dtfProgram.methods
    .burnFolioToken({
      whole: amountToBurn.whole,
      fractional: amountToBurn.fractional,
    })
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      user: userKeypair.publicKey,
      programRegistrar: getProgramRegistrarPDA(),
      dtfProgramSigner: getDtfSignerPDA(),
      dtfProgram: DTF_PROGRAM_ID,
      dtfProgramData: getProgramDataPDA(DTF_PROGRAM_ID),
      folioProgram: FOLIO_PROGRAM_ID,
      folio,
      folioTokenMint,
      folioPendingBasket: getFolioPendingBasketPDA(folio),
      userPendingBasket: getUserPendingBasketPDA(folio, userKeypair.publicKey),
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
    dtfProgram,
    [...getComputeLimitInstruction(600_000), burnFolioTokenIx],
    [],
    {
      skipPreflight: SKIP_PREFLIGHT,
    }
  );
}

export async function redeemFromPendingBasket(
  connection: Connection,
  userKeypair: Keypair,
  folio: PublicKey,
  tokens: { mint: PublicKey; amount: BN }[]
) {
  const dtfProgram = getDtfProgram(connection, userKeypair);

  const redeemFromPendingBasket = await dtfProgram.methods
    .redeemFromPendingBasket(tokens.map((token) => token.amount))
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
      tokenProgram: TOKEN_PROGRAM_ID,
      user: userKeypair.publicKey,
      programRegistrar: getProgramRegistrarPDA(),
      dtfProgramSigner: getDtfSignerPDA(),
      dtfProgram: DTF_PROGRAM_ID,
      dtfProgramData: getProgramDataPDA(DTF_PROGRAM_ID),
      folioProgram: FOLIO_PROGRAM_ID,
      folio,
      folioPendingBasket: getFolioPendingBasketPDA(folio),
      userPendingBasket: getUserPendingBasketPDA(folio, userKeypair.publicKey),
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

  await pSendAndConfirmTxn(dtfProgram, [redeemFromPendingBasket], [], {
    skipPreflight: SKIP_PREFLIGHT,
  });
}
