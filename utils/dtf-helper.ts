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
  getFeeDistributionPDA,
  getTradePDA,
} from "./pda-helper";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { buildRemainingAccounts, getOrCreateAtaAddress } from "./token-helper";

let dtfProgram: Program<Dtfs> = null;

const SKIP_PREFLIGHT = true;

export const MAX_FOLIO_FEE = new BN(13284);
export const MIN_DAO_MINTING_FEE = new BN(500000);
export const SCALAR = new BN(1_000_000_000);

export const MIN_AUCTION_LENGTH = new BN(60);
export const MAX_AUCTION_LENGTH = new BN(604800);
export const MAX_TRADE_DELAY = new BN(604800);

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
  feeRecipientNumerator: BN
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
  folioFee: BN | null,
  mintingFee: BN | null,
  tradeDelay: BN | null,
  auctionLength: BN | null,
  feeRecipientsToAdd: { receiver: PublicKey; portion: BN }[],
  feeRecipientsToRemove: PublicKey[]
) {
  const dtfProgram = getDtfProgram(connection, folioOwnerKeypair);

  const updateFolio = await dtfProgram.methods
    .updateFolio(
      programVersion,
      programDeploymentSlot,
      folioFee,
      mintingFee,
      tradeDelay,
      auctionLength,
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
  tokens: { mint: PublicKey; amount: BN }[],
  initialShares: BN,
  folioTokenMint: PublicKey
) {
  const dtfProgram = getDtfProgram(connection, folioOwnerKeypair);

  const addToBasket = await dtfProgram.methods
    .addToBasket(
      tokens.map((token) => token.amount),
      initialShares
    )
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
      folioTokenMint,
      ownerFolioTokenAccount: await getOrCreateAtaAddress(
        connection,
        folioTokenMint,
        folioOwnerKeypair,
        folioOwnerKeypair.publicKey
      ),
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

export async function killFolio(
  connection: Connection,
  folioOwnerKeypair: Keypair,
  folio: PublicKey
) {
  const dtfProgram = getDtfProgram(connection, folioOwnerKeypair);

  const killFolio = await dtfProgram.methods
    .killFolio()
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

  await pSendAndConfirmTxn(dtfProgram, [killFolio], [], {
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
  shares: BN
) {
  const dtfProgram = getDtfProgram(connection, userKeypair);
  const mintFolioToken = await dtfProgram.methods
    .mintFolioToken(shares)
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
  amountToBurn: BN,
  tokens: { mint: PublicKey; amount: BN }[]
) {
  const dtfProgram = getDtfProgram(connection, userKeypair);

  const burnFolioTokenIx = await dtfProgram.methods
    .burnFolioToken(amountToBurn)
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

export async function distributeFees(
  connection: Connection,
  userKeypair: Keypair,
  folio: PublicKey,
  folioTokenMint: PublicKey,
  daoFeeRecipient: PublicKey,
  index: BN
) {
  const dtfProgram = getDtfProgram(connection, userKeypair);

  const distributeFees = await dtfProgram.methods
    .distributeFees(index)
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
      tokenProgram: TOKEN_PROGRAM_ID,
      user: userKeypair.publicKey,
      dtfProgramSigner: getDtfSignerPDA(),
      dtfProgram: DTF_PROGRAM_ID,
      dtfProgramData: getProgramDataPDA(DTF_PROGRAM_ID),
      daoFeeConfig: getDAOFeeConfigPDA(),
      folioProgram: FOLIO_PROGRAM_ID,
      folio: folio,
      folioTokenMint,
      feeRecipients: getFolioFeeRecipientsPDA(folio),
      feeDistribution: getFeeDistributionPDA(folio, index),
      daoFeeRecipient,
      programRegistrar: getProgramRegistrarPDA(),
    })
    .instruction();

  await pSendAndConfirmTxn(dtfProgram, [distributeFees], [], {
    skipPreflight: SKIP_PREFLIGHT,
  });
}

export async function crankFeeDistribution(
  connection: Connection,
  userKeypair: Keypair,
  folio: PublicKey,
  folioTokenMint: PublicKey,
  cranker: PublicKey,
  feeDistributionIndex: BN,
  indices: BN[],
  feeRecipients: PublicKey[]
) {
  const dtfProgram = getDtfProgram(connection, userKeypair);

  const remainingAccounts = feeRecipients.map((recipient) => {
    return {
      isWritable: true,
      isSigner: false,
      pubkey: recipient,
    };
  });

  const crankFeeDistribution = await dtfProgram.methods
    .crankFeeDistribution(indices)
    .accountsPartial({
      rent: SYSVAR_RENT_PUBKEY,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      user: userKeypair.publicKey,
      dtfProgramSigner: getDtfSignerPDA(),
      dtfProgram: DTF_PROGRAM_ID,
      dtfProgramData: getProgramDataPDA(DTF_PROGRAM_ID),
      folioProgram: FOLIO_PROGRAM_ID,
      folio: folio,
      folioTokenMint,
      cranker,
      feeDistribution: getFeeDistributionPDA(folio, feeDistributionIndex),
      programRegistrar: getProgramRegistrarPDA(),
    })
    .remainingAccounts(remainingAccounts)
    .instruction();

  await pSendAndConfirmTxn(dtfProgram, [crankFeeDistribution], [], {
    skipPreflight: SKIP_PREFLIGHT,
  });
}

export async function approveTrade(
  connection: Connection,
  tradeProposerKeypair: Keypair,
  folio: PublicKey,
  buyMint: PublicKey,
  sellMint: PublicKey,
  tradeId: BN,
  sellLimit: { spot: BN; low: BN; high: BN },
  buyLimit: { spot: BN; low: BN; high: BN },
  startPrice: BN,
  endPrice: BN,
  ttl: BN
) {
  const dtfProgram = getDtfProgram(connection, tradeProposerKeypair);

  const approveTrade = await dtfProgram.methods
    .approveTrade(tradeId, sellLimit, buyLimit, startPrice, endPrice, ttl)
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
      tradeProposer: tradeProposerKeypair.publicKey,
      actor: getActorPDA(tradeProposerKeypair.publicKey, folio),
      dtfProgramSigner: getDtfSignerPDA(),
      dtfProgram: DTF_PROGRAM_ID,
      dtfProgramData: getProgramDataPDA(DTF_PROGRAM_ID),
      folioProgram: FOLIO_PROGRAM_ID,
      folio,
      trade: getTradePDA(folio, tradeId),
      buyMint: buyMint,
      sellMint: sellMint,
      programRegistrar: getProgramRegistrarPDA(),
    })
    .instruction();

  await pSendAndConfirmTxn(dtfProgram, [approveTrade], [], {
    skipPreflight: SKIP_PREFLIGHT,
  });
}

export async function openTrade(
  connection: Connection,
  tradeLauncherKeypair: Keypair,
  folio: PublicKey,
  trade: PublicKey,
  sellLimit: BN,
  buyLimit: BN,
  startPrice: BN,
  endPrice: BN
) {
  const dtfProgram = getDtfProgram(connection, tradeLauncherKeypair);

  const openTrade = await dtfProgram.methods
    .openTrade(sellLimit, buyLimit, startPrice, endPrice)
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      tradeLauncher: tradeLauncherKeypair.publicKey,
      actor: getActorPDA(tradeLauncherKeypair.publicKey, folio),
      dtfProgramSigner: getDtfSignerPDA(),
      dtfProgram: DTF_PROGRAM_ID,
      dtfProgramData: getProgramDataPDA(DTF_PROGRAM_ID),
      folioProgram: FOLIO_PROGRAM_ID,
      folio,
      trade,
      programRegistrar: getProgramRegistrarPDA(),
    })
    .instruction();

  await pSendAndConfirmTxn(dtfProgram, [openTrade], [], {
    skipPreflight: SKIP_PREFLIGHT,
  });
}

export async function openTradePermissionless(
  connection: Connection,
  userKeypair: Keypair,
  folio: PublicKey,
  trade: PublicKey
) {
  const dtfProgram = getDtfProgram(connection, userKeypair);

  const openTradePermissionless = await dtfProgram.methods
    .openTradePermissionless()
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      user: userKeypair.publicKey,
      dtfProgramSigner: getDtfSignerPDA(),
      dtfProgram: DTF_PROGRAM_ID,
      dtfProgramData: getProgramDataPDA(DTF_PROGRAM_ID),
      folioProgram: FOLIO_PROGRAM_ID,
      folio,
      trade,
      programRegistrar: getProgramRegistrarPDA(),
    })
    .instruction();

  await pSendAndConfirmTxn(dtfProgram, [openTradePermissionless], [], {
    skipPreflight: SKIP_PREFLIGHT,
  });
}

export async function killTrade(
  connection: Connection,
  tradeActorKeypair: Keypair,
  folio: PublicKey,
  trade: PublicKey
) {
  const dtfProgram = getDtfProgram(connection, tradeActorKeypair);

  const killTrade = await dtfProgram.methods
    .killTrade()
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      tradeActor: tradeActorKeypair.publicKey,
      actor: getActorPDA(tradeActorKeypair.publicKey, folio),
      dtfProgramSigner: getDtfSignerPDA(),
      dtfProgram: DTF_PROGRAM_ID,
      dtfProgramData: getProgramDataPDA(DTF_PROGRAM_ID),
      folioProgram: FOLIO_PROGRAM_ID,
      folio,
      trade,
      programRegistrar: getProgramRegistrarPDA(),
    })
    .instruction();

  await pSendAndConfirmTxn(dtfProgram, [killTrade], [], {
    skipPreflight: SKIP_PREFLIGHT,
  });
}
