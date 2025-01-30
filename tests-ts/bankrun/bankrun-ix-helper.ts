import { createAndProcessTransaction } from "./bankrun-program-helper";
import { Dtfs } from "../../target/types/dtfs";
import {
  getActorPDA,
  getDAOFeeConfigPDA,
  getDtfSignerPDA,
  getFolioBasketPDA,
  getFolioFeeRecipientsPDA,
  getFolioPDA,
  getFolioSignerPDA,
  getMetadataPDA,
  getProgramDataPDA,
  getProgramRegistrarPDA,
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
import { buildRemainingAccounts, roleToStruct } from "./bankrun-account-helper";
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
