import { createAndProcessTransaction } from "./bankrun-program-helper";
import { Dtfs } from "../../target/types/dtfs";
import {
  getActorPDA,
  getDAOFeeConfigPDA,
  getDtfSignerPDA,
  getFeeDistributionPDA,
  getFolioBasketPDA,
  getFolioFeeRecipientsPDA,
  getFolioPDA,
  getFolioRewardTokensPDA,
  getFolioSignerPDA,
  getMetadataPDA,
  getProgramDataPDA,
  getProgramRegistrarPDA,
  getRewardInfoPDA,
  getUserPendingBasketPDA,
} from "../../utils/pda-helper";
import {
  AccountMeta,
  PublicKey,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction,
} from "@solana/web3.js";
import { SystemProgram } from "@solana/web3.js";
import { BN, Program } from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";
import {
  BanksClient,
  BanksTransactionResultWithMeta,
  ProgramTestContext,
} from "solana-bankrun";
import { ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Folio } from "../../target/types/folio";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { getComputeLimitInstruction } from "../../utils/program-helper";
import {
  FOLIO_PROGRAM_ID,
  OTHER_ADMIN_KEY,
  TOKEN_METADATA_PROGRAM_ID,
} from "../../utils/constants";
import {
  buildRemainingAccounts,
  buildRemainingAccountsForClaimRewards,
  roleToStruct,
} from "./bankrun-account-helper";
import { getOrCreateAtaAddress } from "./bankrun-token-helper";

/*
DTF Directly
*/
export async function initDtfSigner<T extends boolean = true>(
  client: BanksClient,
  programDtf: Program<Dtfs>,
  adminKeypair: Keypair,
  executeTxn: T = true as T
): Promise<
  T extends true
    ? BanksTransactionResultWithMeta
    : { ix: TransactionInstruction; extraSigners: any[] }
> {
  const ix = await programDtf.methods
    .initDtfSigner()
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
      admin: !executeTxn ? OTHER_ADMIN_KEY.publicKey : adminKeypair.publicKey,
      dtfProgramSigner: getDtfSignerPDA(),
    })
    .instruction();

  if (executeTxn) {
    return createAndProcessTransaction(client, adminKeypair, [ix]) as any;
  }

  return { ix, extraSigners: [] } as any;
}

export async function setDaoFeeConfig<T extends boolean = true>(
  client: BanksClient,
  programDtf: Program<Dtfs>,
  adminKeypair: Keypair,
  feeRecipient: PublicKey,
  feeRecipientNumerator: BN,
  executeTxn: T = true as T
): Promise<
  T extends true
    ? BanksTransactionResultWithMeta
    : { ix: TransactionInstruction; extraSigners: any[] }
> {
  const ix = await programDtf.methods
    .setDaoFeeConfig(feeRecipient, feeRecipientNumerator)
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
      admin: !executeTxn ? OTHER_ADMIN_KEY.publicKey : adminKeypair.publicKey,
      daoFeeConfig: getDAOFeeConfigPDA(),
    })
    .instruction();

  if (executeTxn) {
    return createAndProcessTransaction(client, adminKeypair, [ix]) as any;
  }

  return { ix, extraSigners: [] } as any;
}

/*
Through Folio directly
*/
export async function initFolioSigner<T extends boolean = true>(
  client: BanksClient,
  programFolio: Program<Folio>,
  adminKeypair: Keypair,
  executeTxn: T = true as T
): Promise<
  T extends true
    ? BanksTransactionResultWithMeta
    : { ix: TransactionInstruction; extraSigners: any[] }
> {
  const ix = await programFolio.methods
    .initFolioSigner()
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
      admin: !executeTxn ? OTHER_ADMIN_KEY.publicKey : adminKeypair.publicKey,
      folioProgramSigner: getFolioSignerPDA(),
    })
    .instruction();

  if (executeTxn) {
    return createAndProcessTransaction(client, adminKeypair, [ix]) as any;
  }

  return { ix, extraSigners: [] } as any;
}

export async function initProgramRegistrar<T extends boolean = true>(
  client: BanksClient,
  programFolio: Program<Folio>,
  adminKeypair: Keypair,
  dtfAcceptedProgramId: PublicKey,
  executeTxn: T = true as T
): Promise<
  T extends true
    ? BanksTransactionResultWithMeta
    : { ix: TransactionInstruction; extraSigners: any[] }
> {
  const registerProgram = await programFolio.methods
    .initProgramRegistrar(dtfAcceptedProgramId)
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
      admin: !executeTxn ? OTHER_ADMIN_KEY.publicKey : adminKeypair.publicKey,
      programRegistrar: getProgramRegistrarPDA(),
    })
    .instruction();

  if (executeTxn) {
    return createAndProcessTransaction(client, adminKeypair, [
      registerProgram,
    ]) as any;
  }

  return { ix: registerProgram, extraSigners: [] } as any;
}

export async function updateProgramRegistrar<T extends boolean = true>(
  client: BanksClient,
  programFolio: Program<Folio>,
  adminKeypair: Keypair,
  dtfProgramIds: PublicKey[],
  toRemove: boolean,
  executeTxn: T = true as T
): Promise<
  T extends true
    ? BanksTransactionResultWithMeta
    : { ix: TransactionInstruction; extraSigners: any[] }
> {
  const updateProgramRegistrar = await programFolio.methods
    .updateProgramRegistrar(dtfProgramIds, toRemove)
    .accountsPartial({
      admin: !executeTxn ? OTHER_ADMIN_KEY.publicKey : adminKeypair.publicKey,
      programRegistrar: getProgramRegistrarPDA(),
    })
    .instruction();

  if (executeTxn) {
    return createAndProcessTransaction(client, adminKeypair, [
      updateProgramRegistrar,
    ]) as any;
  }

  return { ix: updateProgramRegistrar, extraSigners: [] } as any;
}

export async function initFolio<T extends boolean = true>(
  client: BanksClient,
  programFolio: Program<Folio>,
  folioOwner: Keypair,
  folioTokenMint: Keypair,
  dtfProgramId: PublicKey,
  params: {
    folioFee: BN;
    mintingFee: BN;
    tradeDelay: BN;
    auctionLength: BN;
    name: string;
    symbol: string;
    uri: string;
  },
  executeTxn: T = true as T
): Promise<
  T extends true
    ? BanksTransactionResultWithMeta
    : { ix: TransactionInstruction; extraSigners: any[] }
> {
  const folioPDA = getFolioPDA(folioTokenMint.publicKey);

  const initFolio = await programFolio.methods
    .initFolio(
      params.folioFee,
      params.mintingFee,
      params.tradeDelay,
      params.auctionLength,
      params.name,
      params.symbol,
      params.uri
    )
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      folioOwner: !executeTxn
        ? OTHER_ADMIN_KEY.publicKey
        : folioOwner.publicKey,
      programRegistrar: getProgramRegistrarPDA(),
      folio: folioPDA,
      folioTokenMint: folioTokenMint.publicKey,
      dtfProgram: dtfProgramId,
      dtfProgramData: getProgramDataPDA(dtfProgramId),
      actor: getActorPDA(folioOwner.publicKey, folioPDA),
      tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
      metadata: getMetadataPDA(folioTokenMint.publicKey),
    })
    .instruction();

  if (executeTxn) {
    return createAndProcessTransaction(
      client,
      folioOwner,
      [initFolio],
      [folioTokenMint]
    ) as any;
  }

  return { ix: initFolio, extraSigners: [folioTokenMint] } as any;
}

/*
Through DTF proxy
*/
export async function resizeFolio<T extends boolean = true>(
  client: BanksClient,
  programDtf: Program<Dtfs>,
  folioOwnerKeypair: Keypair,
  folio: PublicKey,
  newSize: BN,
  programId: PublicKey,
  programDataAddress: PublicKey,
  executeTxn: T = true as T
): Promise<
  T extends true
    ? BanksTransactionResultWithMeta
    : { ix: TransactionInstruction; extraSigners: any[] }
> {
  const resizeFolio = await programDtf.methods
    .resizeFolio(newSize)
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
      folioOwner: !executeTxn
        ? OTHER_ADMIN_KEY.publicKey
        : folioOwnerKeypair.publicKey,
      actor: getActorPDA(folioOwnerKeypair.publicKey, folio),
      dtfProgramSigner: getDtfSignerPDA(),
      dtfProgram: programId,
      dtfProgramData: programDataAddress,
      folioProgram: FOLIO_PROGRAM_ID,
      folio: folio,
      programRegistrar: getProgramRegistrarPDA(),
    })
    .instruction();

  if (executeTxn) {
    return createAndProcessTransaction(client, folioOwnerKeypair, [
      resizeFolio,
    ]) as any;
  }

  return { ix: resizeFolio, extraSigners: [] } as any;
}

export async function updateFolio<T extends boolean = true>(
  client: BanksClient,
  programDtf: Program<Dtfs>,
  folioOwnerKeypair: Keypair,
  folio: PublicKey,
  programVersion: PublicKey | null,
  programDeploymentSlot: BN | null,
  folioFee: BN | null,
  mintingFee: BN | null,
  tradeDelay: BN | null,
  auctionLength: BN | null,
  feeRecipientsToAdd: { receiver: PublicKey; portion: BN }[],
  feeRecipientsToRemove: PublicKey[],
  programId: PublicKey,
  programDataAddress: PublicKey,
  executeTxn: T = true as T
): Promise<
  T extends true
    ? BanksTransactionResultWithMeta
    : { ix: TransactionInstruction; extraSigners: any[] }
> {
  const updateFolio = await programDtf.methods
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
      folioOwner: !executeTxn
        ? OTHER_ADMIN_KEY.publicKey
        : folioOwnerKeypair.publicKey,
      actor: getActorPDA(folioOwnerKeypair.publicKey, folio),
      dtfProgramSigner: getDtfSignerPDA(),
      dtfProgram: programId,
      dtfProgramData: programDataAddress,
      folioProgram: FOLIO_PROGRAM_ID,
      folio: folio,
      feeRecipients: getFolioFeeRecipientsPDA(folio),
      programRegistrar: getProgramRegistrarPDA(),
    })
    .instruction();

  if (executeTxn) {
    return createAndProcessTransaction(client, folioOwnerKeypair, [
      ...getComputeLimitInstruction(1_200_000),
      updateFolio,
    ]) as any;
  }

  return { ix: updateFolio, extraSigners: [] } as any;
}

export async function addOrUpdateActor<T extends boolean = true>(
  client: BanksClient,
  programDtf: Program<Dtfs>,
  folioOwnerKeypair: Keypair,
  folio: PublicKey,
  newActorAuthority: PublicKey,
  role: number,
  programId: PublicKey,
  programDataAddress: PublicKey,
  executeTxn: T = true as T
): Promise<
  T extends true
    ? BanksTransactionResultWithMeta
    : { ix: TransactionInstruction; extraSigners: any[] }
> {
  const addOrUpdateActor = await programDtf.methods
    .initOrUpdateActor(roleToStruct(role) as any)
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
      folioOwner: !executeTxn
        ? OTHER_ADMIN_KEY.publicKey
        : folioOwnerKeypair.publicKey,
      newActorAuthority: newActorAuthority,
      folioOwnerActor: getActorPDA(folioOwnerKeypair.publicKey, folio),
      newActor: getActorPDA(newActorAuthority, folio),
      dtfProgramSigner: getDtfSignerPDA(),
      dtfProgram: programId,
      dtfProgramData: programDataAddress,
      folioProgram: FOLIO_PROGRAM_ID,
      folio: folio,
      programRegistrar: getProgramRegistrarPDA(),
    })
    .instruction();

  if (executeTxn) {
    return createAndProcessTransaction(client, folioOwnerKeypair, [
      addOrUpdateActor,
    ]) as any;
  }

  return { ix: addOrUpdateActor, extraSigners: [] } as any;
}

export async function removeActor<T extends boolean = true>(
  client: BanksClient,
  programDtf: Program<Dtfs>,
  folioOwnerKeypair: Keypair,
  folio: PublicKey,
  actorAuthority: PublicKey,
  role: number,
  closeActor: boolean,
  programId: PublicKey,
  programDataAddress: PublicKey,
  executeTxn: T = true as T
): Promise<
  T extends true
    ? BanksTransactionResultWithMeta
    : { ix: TransactionInstruction; extraSigners: any[] }
> {
  const removeActor = await programDtf.methods
    .removeActor(roleToStruct(role) as any, closeActor)
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
      folioOwner: !executeTxn
        ? OTHER_ADMIN_KEY.publicKey
        : folioOwnerKeypair.publicKey,
      actorAuthority: actorAuthority,
      folioOwnerActor: getActorPDA(folioOwnerKeypair.publicKey, folio),
      actorToRemove: getActorPDA(actorAuthority, folio),
      dtfProgramSigner: getDtfSignerPDA(),
      dtfProgram: programId,
      dtfProgramData: programDataAddress,
      folioProgram: FOLIO_PROGRAM_ID,
      folio: folio,
      programRegistrar: getProgramRegistrarPDA(),
    })
    .instruction();

  if (executeTxn) {
    return createAndProcessTransaction(client, folioOwnerKeypair, [
      removeActor,
    ]) as any;
  }

  return { ix: removeActor, extraSigners: [] } as any;
}

export async function addToBasket<T extends boolean = true>(
  context: ProgramTestContext,
  client: BanksClient,
  programDtf: Program<Dtfs>,
  folioOwnerKeypair: Keypair,
  folio: PublicKey,
  tokens: { mint: PublicKey; amount: BN }[],
  initialShares: BN,
  folioTokenMint: PublicKey,
  programId: PublicKey,
  programDataAddress: PublicKey,
  executeTxn: T = true as T,
  remainingAccounts: AccountMeta[] = []
): Promise<
  T extends true
    ? BanksTransactionResultWithMeta
    : { ix: TransactionInstruction; extraSigners: any[] }
> {
  const addToBasket = await programDtf.methods
    .addToBasket(
      tokens.map((token) => token.amount),
      initialShares
    )
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      folioOwner: !executeTxn
        ? OTHER_ADMIN_KEY.publicKey
        : folioOwnerKeypair.publicKey,
      actor: getActorPDA(folioOwnerKeypair.publicKey, folio),
      dtfProgramSigner: getDtfSignerPDA(),
      dtfProgram: programId,
      dtfProgramData: programDataAddress,
      folioProgram: FOLIO_PROGRAM_ID,
      folio: folio,
      folioTokenMint,
      ownerFolioTokenAccount: await getOrCreateAtaAddress(
        context,
        folioTokenMint,
        folioOwnerKeypair.publicKey
      ),
      folioBasket: getFolioBasketPDA(folio),
      programRegistrar: getProgramRegistrarPDA(),
    })
    .remainingAccounts(
      remainingAccounts.length > 0
        ? remainingAccounts
        : await buildRemainingAccounts(
            context,
            tokens,
            folioOwnerKeypair.publicKey,
            folio
          )
    )
    .instruction();

  if (executeTxn) {
    return createAndProcessTransaction(client, folioOwnerKeypair, [
      ...getComputeLimitInstruction(400_000),
      addToBasket,
    ]) as any;
  }

  return { ix: addToBasket, extraSigners: [] } as any;
}

export async function removeFromBasket<T extends boolean = true>(
  client: BanksClient,
  programDtf: Program<Dtfs>,
  folioOwnerKeypair: Keypair,
  folio: PublicKey,
  tokensToRemove: PublicKey[],
  programId: PublicKey,
  programDataAddress: PublicKey,
  executeTxn: T = true as T
): Promise<
  T extends true
    ? BanksTransactionResultWithMeta
    : { ix: TransactionInstruction; extraSigners: any[] }
> {
  const removeFromBasket = await programDtf.methods
    .removeFromBasket(tokensToRemove)
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      folioOwner: !executeTxn
        ? OTHER_ADMIN_KEY.publicKey
        : folioOwnerKeypair.publicKey,
      actor: getActorPDA(folioOwnerKeypair.publicKey, folio),
      dtfProgramSigner: getDtfSignerPDA(),
      dtfProgram: programId,
      dtfProgramData: programDataAddress,
      folioProgram: FOLIO_PROGRAM_ID,
      folio: folio,
      folioBasket: getFolioBasketPDA(folio),
      programRegistrar: getProgramRegistrarPDA(),
    })
    .instruction();

  if (executeTxn) {
    return createAndProcessTransaction(client, folioOwnerKeypair, [
      removeFromBasket,
    ]) as any;
  }

  return { ix: removeFromBasket, extraSigners: [] } as any;
}

export async function addToPendingBasket<T extends boolean = true>(
  context: ProgramTestContext,
  client: BanksClient,
  programDtf: Program<Dtfs>,
  userKeypair: Keypair,
  folio: PublicKey,
  tokens: { mint: PublicKey; amount: BN }[],
  programId: PublicKey,
  programDataAddress: PublicKey,
  executeTxn: T = true as T,
  remainingAccounts: AccountMeta[] = []
): Promise<
  T extends true
    ? BanksTransactionResultWithMeta
    : { ix: TransactionInstruction; extraSigners: any[] }
> {
  const addToPendingBasket = await programDtf.methods
    .addToPendingBasket(tokens.map((token) => token.amount))
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
      tokenProgram: TOKEN_PROGRAM_ID,
      user: userKeypair.publicKey,
      programRegistrar: getProgramRegistrarPDA(),
      folio,
      folioBasket: getFolioBasketPDA(folio),
      userPendingBasket: getUserPendingBasketPDA(folio, userKeypair.publicKey),
      folioProgram: FOLIO_PROGRAM_ID,
      dtfProgramSigner: getDtfSignerPDA(),
      dtfProgram: programId,
      dtfProgramData: programDataAddress,
    })
    .remainingAccounts(
      remainingAccounts.length > 0
        ? remainingAccounts
        : await buildRemainingAccounts(
            context,
            tokens,
            userKeypair.publicKey,
            folio
          )
    )
    .instruction();

  if (executeTxn) {
    return createAndProcessTransaction(client, userKeypair, [
      ...getComputeLimitInstruction(400_000),
      addToPendingBasket,
    ]) as any;
  }

  return { ix: addToPendingBasket, extraSigners: [] } as any;
}

export async function removeFromPendingBasket<T extends boolean = true>(
  context: ProgramTestContext,
  client: BanksClient,
  programDtf: Program<Dtfs>,
  userKeypair: Keypair,
  folio: PublicKey,
  tokens: { mint: PublicKey; amount: BN }[],
  programId: PublicKey,
  programDataAddress: PublicKey,
  executeTxn: T = true as T,
  remainingAccounts: AccountMeta[] = []
): Promise<
  T extends true
    ? BanksTransactionResultWithMeta
    : { ix: TransactionInstruction; extraSigners: any[] }
> {
  const removeFromPendingBasket = await programDtf.methods
    .removeFromPendingBasket(tokens.map((token) => token.amount))
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      user: userKeypair.publicKey,
      programRegistrar: getProgramRegistrarPDA(),
      folio,
      folioBasket: getFolioBasketPDA(folio),
      userPendingBasket: getUserPendingBasketPDA(folio, userKeypair.publicKey),
      folioProgram: FOLIO_PROGRAM_ID,
      dtfProgramSigner: getDtfSignerPDA(),
      dtfProgram: programId,
      dtfProgramData: programDataAddress,
    })
    .remainingAccounts(
      remainingAccounts.length > 0
        ? remainingAccounts
        : await buildRemainingAccounts(
            context,
            tokens,
            folio,
            userKeypair.publicKey
          )
    )
    .instruction();

  if (executeTxn) {
    return createAndProcessTransaction(client, userKeypair, [
      removeFromPendingBasket,
    ]) as any;
  }

  return { ix: removeFromPendingBasket, extraSigners: [] } as any;
}

export async function mintFolioToken<T extends boolean = true>(
  context: ProgramTestContext,
  client: BanksClient,
  programDtf: Program<Dtfs>,
  userKeypair: Keypair,
  folio: PublicKey,
  folioTokenMint: PublicKey,
  tokens: { mint: PublicKey; amount: BN }[],
  shares: BN,
  programId: PublicKey,
  programDataAddress: PublicKey,
  executeTxn: T = true as T,
  remainingAccounts: AccountMeta[] = []
) {
  const mintFolioToken = await programDtf.methods
    .mintFolioToken(shares)
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      user: userKeypair.publicKey,
      programRegistrar: getProgramRegistrarPDA(),
      folio,
      folioTokenMint,
      folioBasket: getFolioBasketPDA(folio),
      userPendingBasket: getUserPendingBasketPDA(folio, userKeypair.publicKey),
      userFolioTokenAccount: await getOrCreateAtaAddress(
        context,
        folioTokenMint,
        userKeypair.publicKey
      ),
      dtfProgramSigner: getDtfSignerPDA(),
      dtfProgram: programId,
      dtfProgramData: programDataAddress,
      folioProgram: FOLIO_PROGRAM_ID,
    })
    .remainingAccounts(
      remainingAccounts.length > 0
        ? remainingAccounts
        : await buildRemainingAccounts(context, tokens, folio, null, false)
    )
    .instruction();

  if (executeTxn) {
    return createAndProcessTransaction(client, userKeypair, [
      ...getComputeLimitInstruction(1_200_000),
      mintFolioToken,
    ]) as any;
  }

  return { ix: mintFolioToken, extraSigners: [] } as any;
}

export async function burnFolioToken<T extends boolean = true>(
  context: ProgramTestContext,
  client: BanksClient,
  programDtf: Program<Dtfs>,
  userKeypair: Keypair,
  folio: PublicKey,
  folioTokenMint: PublicKey,
  amountToBurn: BN,
  tokens: { mint: PublicKey; amount: BN }[],
  programId: PublicKey,
  programDataAddress: PublicKey,
  executeTxn: T = true as T,
  remainingAccounts: AccountMeta[] = []
) {
  const burnFolioTokenIx = await programDtf.methods
    .burnFolioToken(amountToBurn)
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      user: userKeypair.publicKey,
      programRegistrar: getProgramRegistrarPDA(),
      dtfProgramSigner: getDtfSignerPDA(),
      dtfProgram: programId,
      dtfProgramData: programDataAddress,
      folioProgram: FOLIO_PROGRAM_ID,
      folio,
      folioTokenMint,
      folioBasket: getFolioBasketPDA(folio),
      userPendingBasket: getUserPendingBasketPDA(folio, userKeypair.publicKey),
      userFolioTokenAccount: await getOrCreateAtaAddress(
        context,
        folioTokenMint,
        userKeypair.publicKey
      ),
    })
    .remainingAccounts(
      remainingAccounts.length > 0
        ? remainingAccounts
        : await buildRemainingAccounts(context, tokens, folio, null, false)
    )
    .instruction();

  if (executeTxn) {
    return createAndProcessTransaction(client, userKeypair, [
      ...getComputeLimitInstruction(600_000),
      burnFolioTokenIx,
    ]) as any;
  }

  return { ix: burnFolioTokenIx, extraSigners: [] } as any;
}

export async function redeemFromPendingBasket<T extends boolean = true>(
  context: ProgramTestContext,
  client: BanksClient,
  programDtf: Program<Dtfs>,
  userKeypair: Keypair,
  folio: PublicKey,
  tokens: { mint: PublicKey; amount: BN }[],
  programId: PublicKey,
  programDataAddress: PublicKey,
  executeTxn: T = true as T,
  remainingAccounts: AccountMeta[] = []
) {
  const redeemFromPendingBasket = await programDtf.methods
    .redeemFromPendingBasket(tokens.map((token) => token.amount))
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
      tokenProgram: TOKEN_PROGRAM_ID,
      user: userKeypair.publicKey,
      programRegistrar: getProgramRegistrarPDA(),
      dtfProgramSigner: getDtfSignerPDA(),
      dtfProgram: programId,
      dtfProgramData: programDataAddress,
      folioProgram: FOLIO_PROGRAM_ID,
      folio,
      folioBasket: getFolioBasketPDA(folio),
      userPendingBasket: getUserPendingBasketPDA(folio, userKeypair.publicKey),
    })
    .remainingAccounts(
      remainingAccounts.length > 0
        ? remainingAccounts
        : await buildRemainingAccounts(
            context,
            tokens,
            folio,
            userKeypair.publicKey
          )
    )
    .instruction();

  if (executeTxn) {
    return createAndProcessTransaction(client, userKeypair, [
      ...getComputeLimitInstruction(600_000),
      redeemFromPendingBasket,
    ]) as any;
  }

  return { ix: redeemFromPendingBasket, extraSigners: [] } as any;
}

export async function pokeFolio<T extends boolean = true>(
  client: BanksClient,
  programDtf: Program<Dtfs>,
  userKeypair: Keypair,
  folioPDA: PublicKey,
  folioTokenMint: PublicKey,
  programId: PublicKey,
  programDataAddress: PublicKey,
  executeTxn: T = true as T
): Promise<
  T extends true
    ? BanksTransactionResultWithMeta
    : { ix: TransactionInstruction; extraSigners: any[] }
> {
  const pokeFolio = await programDtf.methods
    .pokeFolio()
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      user: userKeypair.publicKey,
      folio: folioPDA,
      folioTokenMint: folioTokenMint,
      dtfProgram: programId,
      folioProgram: FOLIO_PROGRAM_ID,
      daoFeeConfig: getDAOFeeConfigPDA(),
      dtfProgramSigner: getDtfSignerPDA(),
      dtfProgramData: programDataAddress,
      programRegistrar: getProgramRegistrarPDA(),
    })
    .instruction();

  if (executeTxn) {
    return createAndProcessTransaction(client, userKeypair, [pokeFolio]) as any;
  }

  return { ix: pokeFolio, extraSigners: [] } as any;
}

export async function distributeFees<T extends boolean = true>(
  client: BanksClient,
  programDtf: Program<Dtfs>,
  userKeypair: Keypair,
  folio: PublicKey,
  folioTokenMint: PublicKey,
  daoFeeRecipient: PublicKey,
  index: BN,
  programId: PublicKey,
  programDataAddress: PublicKey,
  executeTxn: T = true as T
): Promise<
  T extends true
    ? BanksTransactionResultWithMeta
    : { ix: TransactionInstruction; extraSigners: any[] }
> {
  const distributeFees = await programDtf.methods
    .distributeFees(index)
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
      tokenProgram: TOKEN_PROGRAM_ID,
      user: userKeypair.publicKey,
      dtfProgramSigner: getDtfSignerPDA(),
      dtfProgram: programId,
      dtfProgramData: programDataAddress,
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

  if (executeTxn) {
    return createAndProcessTransaction(client, userKeypair, [
      distributeFees,
    ]) as any;
  }

  return { ix: distributeFees, extraSigners: [] } as any;
}

export async function crankFeeDistribution<T extends boolean = true>(
  client: BanksClient,
  programDtf: Program<Dtfs>,
  userKeypair: Keypair,
  folio: PublicKey,
  folioTokenMint: PublicKey,
  cranker: PublicKey,
  feeDistributionIndex: BN,
  indices: BN[],
  feeRecipients: PublicKey[],
  programId: PublicKey,
  programDataAddress: PublicKey,
  executeTxn: T = true as T,
  remainingAccounts: AccountMeta[] = []
): Promise<
  T extends true
    ? BanksTransactionResultWithMeta
    : { ix: TransactionInstruction; extraSigners: any[] }
> {
  const crankFeeDistribution = await programDtf.methods
    .crankFeeDistribution(indices)
    .accountsPartial({
      rent: SYSVAR_RENT_PUBKEY,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      user: userKeypair.publicKey,
      dtfProgramSigner: getDtfSignerPDA(),
      dtfProgram: programId,
      dtfProgramData: programDataAddress,
      folioProgram: FOLIO_PROGRAM_ID,
      folio: folio,
      folioTokenMint,
      cranker,
      feeDistribution: getFeeDistributionPDA(folio, feeDistributionIndex),
      programRegistrar: getProgramRegistrarPDA(),
    })
    .remainingAccounts(
      remainingAccounts.length > 0
        ? remainingAccounts
        : feeRecipients.map((recipient) => {
            return {
              isWritable: true,
              isSigner: false,
              pubkey: recipient,
            };
          })
    )
    .instruction();

  if (executeTxn) {
    return createAndProcessTransaction(client, userKeypair, [
      ...getComputeLimitInstruction(400_000),
      crankFeeDistribution,
    ]) as any;
  }

  return { ix: crankFeeDistribution, extraSigners: [] } as any;
}

export async function addRewardToken<T extends boolean = true>(
  context: ProgramTestContext,
  client: BanksClient,
  programDtf: Program<Dtfs>,
  ownerKeypair: Keypair,
  folio: PublicKey,
  rewardToken: PublicKey,
  rewardPeriod: BN,
  programId: PublicKey,
  programDataAddress: PublicKey,
  executeTxn: T = true as T,
  rewardTokenATA: PublicKey = null
): Promise<
  T extends true
    ? BanksTransactionResultWithMeta
    : { ix: TransactionInstruction; extraSigners: any[] }
> {
  const addRewardToken = await programDtf.methods
    .addRewardToken(rewardPeriod)
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      folioOwner: ownerKeypair.publicKey,
      dtfProgramSigner: getDtfSignerPDA(),
      dtfProgram: programId,
      dtfProgramData: programDataAddress,
      folioProgram: FOLIO_PROGRAM_ID,
      actor: getActorPDA(ownerKeypair.publicKey, folio),
      folio,
      folioRewardTokens: getFolioRewardTokensPDA(folio),
      rewardTokenRewardInfo: getRewardInfoPDA(folio, rewardToken),
      rewardToken,
      rewardTokenAccount:
        rewardTokenATA ??
        (await getOrCreateAtaAddress(
          context,
          rewardToken,
          getFolioRewardTokensPDA(folio)
        )),
      programRegistrar: getProgramRegistrarPDA(),
    })
    .instruction();

  if (executeTxn) {
    return createAndProcessTransaction(client, ownerKeypair, [
      ...getComputeLimitInstruction(800_000),
      addRewardToken,
    ]) as any;
  }

  return { ix: addRewardToken, extraSigners: [] } as any;
}

export async function removeRewardToken<T extends boolean = true>(
  client: BanksClient,
  programDtf: Program<Dtfs>,
  ownerKeypair: Keypair,
  folio: PublicKey,
  rewardTokenToRemove: PublicKey,
  programId: PublicKey,
  programDataAddress: PublicKey,
  executeTxn: T = true as T
): Promise<
  T extends true
    ? BanksTransactionResultWithMeta
    : { ix: TransactionInstruction; extraSigners: any[] }
> {
  const removeRewardToken = await programDtf.methods
    .removeRewardToken()
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      folioOwner: ownerKeypair.publicKey,
      dtfProgramSigner: getDtfSignerPDA(),
      dtfProgram: programId,
      dtfProgramData: programDataAddress,
      folioProgram: FOLIO_PROGRAM_ID,
      actor: getActorPDA(ownerKeypair.publicKey, folio),
      folio,
      folioRewardTokens: getFolioRewardTokensPDA(folio),
      rewardTokenToRemove,
      programRegistrar: getProgramRegistrarPDA(),
    })
    .instruction();

  if (executeTxn) {
    return createAndProcessTransaction(client, ownerKeypair, [
      removeRewardToken,
    ]) as any;
  }

  return { ix: removeRewardToken, extraSigners: [] } as any;
}

export async function initOrSetRewardRatio<T extends boolean = true>(
  client: BanksClient,
  programDtf: Program<Dtfs>,
  ownerKeypair: Keypair,
  folio: PublicKey,
  rewardPeriod: BN,
  programId: PublicKey,
  programDataAddress: PublicKey,
  executeTxn: T = true as T
): Promise<
  T extends true
    ? BanksTransactionResultWithMeta
    : { ix: TransactionInstruction; extraSigners: any[] }
> {
  const initOrSetRewardRatio = await programDtf.methods
    .initOrSetRewardRatio(rewardPeriod)
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      folioOwner: ownerKeypair.publicKey,
      dtfProgramSigner: getDtfSignerPDA(),
      dtfProgram: programId,
      dtfProgramData: programDataAddress,
      folioProgram: FOLIO_PROGRAM_ID,
      actor: getActorPDA(ownerKeypair.publicKey, folio),
      folio,
      folioRewardTokens: getFolioRewardTokensPDA(folio),
      programRegistrar: getProgramRegistrarPDA(),
    })
    .instruction();

  if (executeTxn) {
    return createAndProcessTransaction(client, ownerKeypair, [
      initOrSetRewardRatio,
    ]) as any;
  }

  return { ix: initOrSetRewardRatio, extraSigners: [] } as any;
}

export async function accrueRewards<T extends boolean = true>(
  context: ProgramTestContext,
  client: BanksClient,
  programDtf: Program<Dtfs>,
  callerKeypair: Keypair,
  folioOwner: PublicKey,
  folio: PublicKey,
  rewardTokens: PublicKey[],
  extraUser: PublicKey = callerKeypair.publicKey,
  programId: PublicKey,
  programDataAddress: PublicKey,
  executeTxn: T = true as T,
  remainingAccounts: AccountMeta[] = []
): Promise<
  T extends true
    ? BanksTransactionResultWithMeta
    : { ix: TransactionInstruction; extraSigners: any[] }
> {
  const accrueRewards = await programDtf.methods
    .accrueRewards()
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      caller: callerKeypair.publicKey,
      dtfProgramSigner: getDtfSignerPDA(),
      dtfProgram: programId,
      dtfProgramData: programDataAddress,
      folioProgram: FOLIO_PROGRAM_ID,
      folioOwner,
      actor: getActorPDA(folioOwner, folio),
      folio,
      folioRewardTokens: getFolioRewardTokensPDA(folio),
      user: extraUser ?? callerKeypair.publicKey,
      programRegistrar: getProgramRegistrarPDA(),
    })
    .remainingAccounts(remainingAccounts)
    .instruction();

  if (executeTxn) {
    return createAndProcessTransaction(client, callerKeypair, [
      ...getComputeLimitInstruction(600_000),
      accrueRewards,
    ]) as any;
  }

  return { ix: accrueRewards, extraSigners: [] } as any;
}

export async function claimRewards<T extends boolean = true>(
  context: ProgramTestContext,
  client: BanksClient,
  programDtf: Program<Dtfs>,
  userKeypair: Keypair,
  folioOwner: PublicKey,
  folio: PublicKey,
  rewardTokens: PublicKey[],
  programId: PublicKey,
  programDataAddress: PublicKey,
  executeTxn: T = true as T,
  remainingAccounts: AccountMeta[] = []
): Promise<
  T extends true
    ? BanksTransactionResultWithMeta
    : { ix: TransactionInstruction; extraSigners: any[] }
> {
  const claimRewards = await programDtf.methods
    .claimRewards()
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      user: userKeypair.publicKey,
      dtfProgramSigner: getDtfSignerPDA(),
      dtfProgram: programId,
      dtfProgramData: programDataAddress,
      folioProgram: FOLIO_PROGRAM_ID,
      folioOwner,
      actor: getActorPDA(folioOwner, folio),
      folio,
      folioRewardTokens: getFolioRewardTokensPDA(folio),
      programRegistrar: getProgramRegistrarPDA(),
    })
    .remainingAccounts(
      remainingAccounts.length > 0
        ? remainingAccounts
        : await buildRemainingAccountsForClaimRewards(
            context,
            userKeypair,
            folio,
            rewardTokens
          )
    )
    .instruction();

  if (executeTxn) {
    return createAndProcessTransaction(client, userKeypair, [
      claimRewards,
    ]) as any;
  }

  return { ix: claimRewards, extraSigners: [] } as any;
}
