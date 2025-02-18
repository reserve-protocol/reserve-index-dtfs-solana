import { createAndProcessTransaction } from "./bankrun-program-helper";
import {
  getActorPDA,
  getDAOFeeConfigPDA,
  getFeeDistributionPDA,
  getFolioBasketPDA,
  getTVLFeeRecipientsPDA,
  getFolioPDA,
  getFolioRewardTokensPDA,
  getMetadataPDA,
  getProgramRegistrarPDA,
  getRewardInfoPDA,
  getAuctionPDA,
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
  OTHER_ADMIN_KEY,
  TOKEN_METADATA_PROGRAM_ID,
} from "../../utils/constants";
import {
  buildRemainingAccounts,
  buildRemainingAccountsForClaimRewards,
  buildRemainingAccountsForMigrateFolioTokens,
  roleToStruct,
  Auction,
} from "./bankrun-account-helper";
import { getOrCreateAtaAddress } from "./bankrun-token-helper";
import { FolioAdmin } from "../../target/types/folio_admin";

/*
Folio Admin
*/
export async function setDaoFeeConfig<T extends boolean = true>(
  client: BanksClient,
  programFolioAdmin: Program<FolioAdmin>,
  adminKeypair: Keypair,
  feeRecipient: PublicKey,
  feeRecipientNumerator: BN,
  feeFloor: BN,
  executeTxn: T = true as T
): Promise<
  T extends true
    ? BanksTransactionResultWithMeta
    : { ix: TransactionInstruction; extraSigners: any[] }
> {
  const ix = await programFolioAdmin.methods
    .setDaoFeeConfig(feeRecipient, feeRecipientNumerator, feeFloor)
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

export async function initProgramRegistrar<T extends boolean = true>(
  client: BanksClient,
  programFolioAdmin: Program<FolioAdmin>,
  adminKeypair: Keypair,
  folioAcceptedProgramId: PublicKey,
  executeTxn: T = true as T
): Promise<
  T extends true
    ? BanksTransactionResultWithMeta
    : { ix: TransactionInstruction; extraSigners: any[] }
> {
  const registerProgram = await programFolioAdmin.methods
    .initProgramRegistrar(folioAcceptedProgramId)
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
  programFolioAdmin: Program<FolioAdmin>,
  adminKeypair: Keypair,
  folioProgramIds: PublicKey[],
  toRemove: boolean,
  executeTxn: T = true as T
): Promise<
  T extends true
    ? BanksTransactionResultWithMeta
    : { ix: TransactionInstruction; extraSigners: any[] }
> {
  const updateProgramRegistrar = await programFolioAdmin.methods
    .updateProgramRegistrar(folioProgramIds, toRemove)
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

/*
Folio
*/
export async function initFolio<T extends boolean = true>(
  client: BanksClient,
  programFolio: Program<Folio>,
  folioOwner: Keypair,
  folioTokenMint: Keypair,
  params: {
    tvlFee: BN;
    mintFee: BN;
    auctionDelay: BN;
    auctionLength: BN;
    name: string;
    symbol: string;
    uri: string;
    mandate: string;
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
      params.tvlFee,
      params.mintFee,
      params.auctionDelay,
      params.auctionLength,
      params.name,
      params.symbol,
      params.uri,
      params.mandate
    )
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      folioOwner: !executeTxn
        ? OTHER_ADMIN_KEY.publicKey
        : folioOwner.publicKey,
      folio: folioPDA,
      folioTokenMint: folioTokenMint.publicKey,
      actor: getActorPDA(folioOwner.publicKey, folioPDA),
      tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
      metadata: getMetadataPDA(folioTokenMint.publicKey),
    })
    .instruction();

  if (executeTxn) {
    return createAndProcessTransaction(
      client,
      folioOwner,
      [...getComputeLimitInstruction(600_000), initFolio],
      [folioTokenMint]
    ) as any;
  }

  return { ix: initFolio, extraSigners: [folioTokenMint] } as any;
}

export async function resizeFolio<T extends boolean = true>(
  client: BanksClient,
  programFolio: Program<Folio>,
  folioOwnerKeypair: Keypair,
  folio: PublicKey,
  newSize: BN,

  executeTxn: T = true as T
): Promise<
  T extends true
    ? BanksTransactionResultWithMeta
    : { ix: TransactionInstruction; extraSigners: any[] }
> {
  const resizeFolio = await programFolio.methods
    .resizeFolio(newSize)
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
      folioOwner: !executeTxn
        ? OTHER_ADMIN_KEY.publicKey
        : folioOwnerKeypair.publicKey,
      actor: getActorPDA(folioOwnerKeypair.publicKey, folio),

      folio: folio,
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
  programFolio: Program<Folio>,
  folioOwnerKeypair: Keypair,
  folio: PublicKey,
  tvlFee: BN | null,
  mintFee: BN | null,
  auctionDelay: BN | null,
  auctionLength: BN | null,
  feeRecipientsToAdd: { recipient: PublicKey; portion: BN }[],
  feeRecipientsToRemove: PublicKey[],
  mandate: string | null,
  executeTxn: T = true as T
): Promise<
  T extends true
    ? BanksTransactionResultWithMeta
    : { ix: TransactionInstruction; extraSigners: any[] }
> {
  const updateFolio = await programFolio.methods
    .updateFolio(
      tvlFee,
      mintFee,
      auctionDelay,
      auctionLength,
      feeRecipientsToAdd,
      feeRecipientsToRemove,
      mandate
    )
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
      folioOwner: !executeTxn
        ? OTHER_ADMIN_KEY.publicKey
        : folioOwnerKeypair.publicKey,
      actor: getActorPDA(folioOwnerKeypair.publicKey, folio),

      folio: folio,
      feeRecipients: getTVLFeeRecipientsPDA(folio),
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
  programFolio: Program<Folio>,
  folioOwnerKeypair: Keypair,
  folio: PublicKey,
  newActorAuthority: PublicKey,
  role: number,

  executeTxn: T = true as T
): Promise<
  T extends true
    ? BanksTransactionResultWithMeta
    : { ix: TransactionInstruction; extraSigners: any[] }
> {
  const addOrUpdateActor = await programFolio.methods
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

      folio: folio,
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
  programFolio: Program<Folio>,
  folioOwnerKeypair: Keypair,
  folio: PublicKey,
  actorAuthority: PublicKey,
  role: number,
  closeActor: boolean,

  executeTxn: T = true as T
): Promise<
  T extends true
    ? BanksTransactionResultWithMeta
    : { ix: TransactionInstruction; extraSigners: any[] }
> {
  const removeActor = await programFolio.methods
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

      folio: folio,
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
  programFolio: Program<Folio>,
  folioOwnerKeypair: Keypair,
  folio: PublicKey,
  tokens: { mint: PublicKey; amount: BN }[],
  initialShares: BN,
  folioTokenMint: PublicKey,

  executeTxn: T = true as T,
  remainingAccounts: AccountMeta[] = []
): Promise<
  T extends true
    ? BanksTransactionResultWithMeta
    : { ix: TransactionInstruction; extraSigners: any[] }
> {
  const addToBasket = await programFolio.methods
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

      folio: folio,
      folioTokenMint,
      ownerFolioTokenAccount: await getOrCreateAtaAddress(
        context,
        folioTokenMint,
        folioOwnerKeypair.publicKey
      ),
      folioBasket: getFolioBasketPDA(folio),
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
  programFolio: Program<Folio>,
  folioOwnerKeypair: Keypair,
  folio: PublicKey,
  tokensToRemove: PublicKey[],

  executeTxn: T = true as T
): Promise<
  T extends true
    ? BanksTransactionResultWithMeta
    : { ix: TransactionInstruction; extraSigners: any[] }
> {
  const removeFromBasket = await programFolio.methods
    .removeFromBasket(tokensToRemove)
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      folioOwner: !executeTxn
        ? OTHER_ADMIN_KEY.publicKey
        : folioOwnerKeypair.publicKey,
      actor: getActorPDA(folioOwnerKeypair.publicKey, folio),

      folio: folio,
      folioBasket: getFolioBasketPDA(folio),
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
  programFolio: Program<Folio>,
  userKeypair: Keypair,
  folio: PublicKey,
  tokens: { mint: PublicKey; amount: BN }[],

  executeTxn: T = true as T,
  remainingAccounts: AccountMeta[] = []
): Promise<
  T extends true
    ? BanksTransactionResultWithMeta
    : { ix: TransactionInstruction; extraSigners: any[] }
> {
  const addToPendingBasket = await programFolio.methods
    .addToPendingBasket(tokens.map((token) => token.amount))
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
      tokenProgram: TOKEN_PROGRAM_ID,
      user: userKeypair.publicKey,

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
  programFolio: Program<Folio>,
  userKeypair: Keypair,
  folio: PublicKey,
  tokens: { mint: PublicKey; amount: BN }[],

  executeTxn: T = true as T,
  remainingAccounts: AccountMeta[] = []
): Promise<
  T extends true
    ? BanksTransactionResultWithMeta
    : { ix: TransactionInstruction; extraSigners: any[] }
> {
  const removeFromPendingBasket = await programFolio.methods
    .removeFromPendingBasket(tokens.map((token) => token.amount))
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      user: userKeypair.publicKey,

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
      removeFromPendingBasket,
    ]) as any;
  }

  return { ix: removeFromPendingBasket, extraSigners: [] } as any;
}

export async function mintFolioToken<T extends boolean = true>(
  context: ProgramTestContext,
  client: BanksClient,
  programFolio: Program<Folio>,
  userKeypair: Keypair,
  folio: PublicKey,
  folioTokenMint: PublicKey,
  tokens: { mint: PublicKey; amount: BN }[],
  shares: BN,

  executeTxn: T = true as T,
  remainingAccounts: AccountMeta[] = []
) {
  const mintFolioToken = await programFolio.methods
    .mintFolioToken(shares)
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      user: userKeypair.publicKey,

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
      ...getComputeLimitInstruction(1_200_000),
      mintFolioToken,
    ]) as any;
  }

  return { ix: mintFolioToken, extraSigners: [] } as any;
}

export async function burnFolioToken<T extends boolean = true>(
  context: ProgramTestContext,
  client: BanksClient,
  programFolio: Program<Folio>,
  userKeypair: Keypair,
  folio: PublicKey,
  folioTokenMint: PublicKey,
  amountToBurn: BN,
  tokens: { mint: PublicKey; amount: BN }[],

  executeTxn: T = true as T,
  remainingAccounts: AccountMeta[] = []
) {
  const burnFolioTokenIx = await programFolio.methods
    .burnFolioToken(amountToBurn)
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      user: userKeypair.publicKey,

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
  programFolio: Program<Folio>,
  userKeypair: Keypair,
  folio: PublicKey,
  tokens: { mint: PublicKey; amount: BN }[],

  executeTxn: T = true as T,
  remainingAccounts: AccountMeta[] = []
) {
  const redeemFromPendingBasket = await programFolio.methods
    .redeemFromPendingBasket(tokens.map((token) => token.amount))
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
      tokenProgram: TOKEN_PROGRAM_ID,
      user: userKeypair.publicKey,

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
  programFolio: Program<Folio>,
  userKeypair: Keypair,
  folioPDA: PublicKey,
  folioTokenMint: PublicKey,

  executeTxn: T = true as T
): Promise<
  T extends true
    ? BanksTransactionResultWithMeta
    : { ix: TransactionInstruction; extraSigners: any[] }
> {
  const pokeFolio = await programFolio.methods
    .pokeFolio()
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      user: userKeypair.publicKey,
      folio: folioPDA,
      folioTokenMint: folioTokenMint,

      daoFeeConfig: getDAOFeeConfigPDA(),
    })
    .instruction();

  if (executeTxn) {
    return createAndProcessTransaction(client, userKeypair, [pokeFolio]) as any;
  }

  return { ix: pokeFolio, extraSigners: [] } as any;
}

export async function distributeFees<T extends boolean = true>(
  client: BanksClient,
  programFolio: Program<Folio>,
  userKeypair: Keypair,
  folio: PublicKey,
  folioTokenMint: PublicKey,
  daoFeeRecipient: PublicKey,
  index: BN,

  executeTxn: T = true as T
): Promise<
  T extends true
    ? BanksTransactionResultWithMeta
    : { ix: TransactionInstruction; extraSigners: any[] }
> {
  const distributeFees = await programFolio.methods
    .distributeFees(index)
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
      tokenProgram: TOKEN_PROGRAM_ID,
      user: userKeypair.publicKey,

      daoFeeConfig: getDAOFeeConfigPDA(),

      folio: folio,
      folioTokenMint,
      feeRecipients: getTVLFeeRecipientsPDA(folio),
      feeDistribution: getFeeDistributionPDA(folio, index),
      daoFeeRecipient,
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
  programFolio: Program<Folio>,
  userKeypair: Keypair,
  folio: PublicKey,
  folioTokenMint: PublicKey,
  cranker: PublicKey,
  feeDistributionIndex: BN,
  indices: BN[],
  feeRecipients: PublicKey[],

  executeTxn: T = true as T,
  remainingAccounts: AccountMeta[] = []
): Promise<
  T extends true
    ? BanksTransactionResultWithMeta
    : { ix: TransactionInstruction; extraSigners: any[] }
> {
  const crankFeeDistribution = await programFolio.methods
    .crankFeeDistribution(indices)
    .accountsPartial({
      rent: SYSVAR_RENT_PUBKEY,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      user: userKeypair.publicKey,

      folio: folio,
      folioTokenMint,
      cranker,
      feeDistribution: getFeeDistributionPDA(folio, feeDistributionIndex),
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
  programFolio: Program<Folio>,
  ownerKeypair: Keypair,
  folio: PublicKey,
  rewardToken: PublicKey,
  rewardPeriod: BN,

  executeTxn: T = true as T,
  rewardTokenATA: PublicKey = null
): Promise<
  T extends true
    ? BanksTransactionResultWithMeta
    : { ix: TransactionInstruction; extraSigners: any[] }
> {
  const addRewardToken = await programFolio.methods
    .addRewardToken(rewardPeriod)
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      folioOwner: ownerKeypair.publicKey,

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
  programFolio: Program<Folio>,
  ownerKeypair: Keypair,
  folio: PublicKey,
  rewardTokenToRemove: PublicKey,

  executeTxn: T = true as T
): Promise<
  T extends true
    ? BanksTransactionResultWithMeta
    : { ix: TransactionInstruction; extraSigners: any[] }
> {
  const removeRewardToken = await programFolio.methods
    .removeRewardToken()
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      folioOwner: ownerKeypair.publicKey,

      actor: getActorPDA(ownerKeypair.publicKey, folio),
      folio,
      folioRewardTokens: getFolioRewardTokensPDA(folio),
      rewardTokenToRemove,
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
  programFolio: Program<Folio>,
  ownerKeypair: Keypair,
  folio: PublicKey,
  rewardPeriod: BN,

  executeTxn: T = true as T
): Promise<
  T extends true
    ? BanksTransactionResultWithMeta
    : { ix: TransactionInstruction; extraSigners: any[] }
> {
  const initOrSetRewardRatio = await programFolio.methods
    .initOrSetRewardRatio(rewardPeriod)
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      folioOwner: ownerKeypair.publicKey,

      actor: getActorPDA(ownerKeypair.publicKey, folio),
      folio,
      folioRewardTokens: getFolioRewardTokensPDA(folio),
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
  client: BanksClient,
  programFolio: Program<Folio>,
  callerKeypair: Keypair,
  folioOwner: PublicKey,
  folio: PublicKey,
  governanceMint: PublicKey,
  governanceHoldingTokenAccount: PublicKey,
  extraUser: PublicKey = callerKeypair.publicKey,
  executeTxn: T = true as T,
  remainingAccounts: AccountMeta[] = []
): Promise<
  T extends true
    ? BanksTransactionResultWithMeta
    : { ix: TransactionInstruction; extraSigners: any[] }
> {
  const accrueRewards = await programFolio.methods
    .accrueRewards()
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      caller: callerKeypair.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      folioOwner,
      actor: getActorPDA(folioOwner, folio),
      folio,
      folioRewardTokens: getFolioRewardTokensPDA(folio),
      governanceTokenMint: governanceMint,
      governanceStakedTokenAccount: governanceHoldingTokenAccount,
      user: extraUser ?? callerKeypair.publicKey,
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
  programFolio: Program<Folio>,
  userKeypair: Keypair,
  folioOwner: PublicKey,
  folio: PublicKey,
  rewardTokens: PublicKey[],
  executeTxn: T = true as T,
  remainingAccounts: AccountMeta[] = []
): Promise<
  T extends true
    ? BanksTransactionResultWithMeta
    : { ix: TransactionInstruction; extraSigners: any[] }
> {
  const claimRewards = await programFolio.methods
    .claimRewards()
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      user: userKeypair.publicKey,

      folioOwner,
      actor: getActorPDA(folioOwner, folio),
      folio,
      folioRewardTokens: getFolioRewardTokensPDA(folio),
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

export async function approveAuction<T extends boolean = true>(
  client: BanksClient,
  programFolio: Program<Folio>,
  auctionApproverKeypair: Keypair,
  folio: PublicKey,
  auction: Auction,
  ttl: BN,
  executeTxn: T = true as T
): Promise<
  T extends true
    ? BanksTransactionResultWithMeta
    : { ix: TransactionInstruction; extraSigners: any[] }
> {
  const approveAuction = await programFolio.methods
    .approveAuction(
      auction.id,
      auction.sellLimit,
      auction.buyLimit,
      auction.prices,
      ttl
    )
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
      auctionApprover: auctionApproverKeypair.publicKey,
      actor: getActorPDA(auctionApproverKeypair.publicKey, folio),
      folio,
      auction: getAuctionPDA(folio, auction.id),
      buyMint: auction.buy,
      sellMint: auction.sell,
    })
    .instruction();

  if (executeTxn) {
    return createAndProcessTransaction(client, auctionApproverKeypair, [
      approveAuction,
    ]) as any;
  }

  return { ix: approveAuction, extraSigners: [] } as any;
}

export async function openAuction<T extends boolean = true>(
  client: BanksClient,
  programFolio: Program<Folio>,
  auctionLauncherKeypair: Keypair,
  folio: PublicKey,
  auction: PublicKey,
  auctionData: Auction,
  executeTxn: T = true as T
): Promise<
  T extends true
    ? BanksTransactionResultWithMeta
    : { ix: TransactionInstruction; extraSigners: any[] }
> {
  const openAuction = await programFolio.methods
    .openAuction(
      auctionData.sellLimit.spot,
      auctionData.buyLimit.spot,
      auctionData.prices.start,
      auctionData.prices.end
    )
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      auctionLauncher: auctionLauncherKeypair.publicKey,
      actor: getActorPDA(auctionLauncherKeypair.publicKey, folio),
      folio,
      auction,
    })
    .instruction();

  if (executeTxn) {
    return createAndProcessTransaction(client, auctionLauncherKeypair, [
      openAuction,
    ]) as any;
  }

  return { ix: openAuction, extraSigners: [] } as any;
}

export async function openAuctionPermissionless<T extends boolean = true>(
  client: BanksClient,
  programFolio: Program<Folio>,
  userKeypair: Keypair,
  folio: PublicKey,
  auction: PublicKey,
  executeTxn: T = true as T
): Promise<
  T extends true
    ? BanksTransactionResultWithMeta
    : { ix: TransactionInstruction; extraSigners: any[] }
> {
  const openAuctionPermissionless = await programFolio.methods
    .openAuctionPermissionless()
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      user: userKeypair.publicKey,
      folio,
      auction,
    })
    .instruction();

  if (executeTxn) {
    return createAndProcessTransaction(client, userKeypair, [
      openAuctionPermissionless,
    ]) as any;
  }

  return { ix: openAuctionPermissionless, extraSigners: [] } as any;
}

export async function killAuction<T extends boolean = true>(
  client: BanksClient,
  programFolio: Program<Folio>,
  auctionActorKeypair: Keypair,
  folio: PublicKey,
  auction: PublicKey,
  executeTxn: T = true as T
): Promise<
  T extends true
    ? BanksTransactionResultWithMeta
    : { ix: TransactionInstruction; extraSigners: any[] }
> {
  const killAuction = await programFolio.methods
    .closeAuction()
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      auctionActor: auctionActorKeypair.publicKey,
      actor: getActorPDA(auctionActorKeypair.publicKey, folio),
      folio,
      auction,
    })
    .instruction();

  if (executeTxn) {
    return createAndProcessTransaction(client, auctionActorKeypair, [
      killAuction,
    ]) as any;
  }

  return { ix: killAuction, extraSigners: [] } as any;
}

export async function bid<T extends boolean = true>(
  context: ProgramTestContext,
  client: BanksClient,
  programFolio: Program<Folio>,
  bidderKeypair: Keypair,
  folio: PublicKey,
  folioTokenMint: PublicKey,
  auction: PublicKey,
  sellAmount: BN,
  maxBuyAmount: BN,
  withCallback: boolean = false,
  sellMint: PublicKey = null,
  buyMint: PublicKey = null,
  callbackData: Buffer = Buffer.from([]),
  executeTxn: T = true as T,
  remainingAccountsForCallback: AccountMeta[] = []
): Promise<
  T extends true
    ? BanksTransactionResultWithMeta
    : { ix: TransactionInstruction; extraSigners: any[] }
> {
  const auctionFetched = await programFolio.account.auction.fetch(auction);

  const sellMintToUse = sellMint ?? auctionFetched.sell;
  const buyMintToUse = buyMint ?? auctionFetched.buy;

  const bid = await programFolio.methods
    .bid(sellAmount, maxBuyAmount, withCallback, callbackData)
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      bidder: bidderKeypair.publicKey,
      folio,
      folioBasket: getFolioBasketPDA(folio),
      auction,
      folioTokenMint,
      auctionSellTokenMint: sellMintToUse,
      auctionBuyTokenMint: buyMintToUse,
      folioSellTokenAccount: await getOrCreateAtaAddress(
        context,
        sellMintToUse,
        folio
      ),
      folioBuyTokenAccount: await getOrCreateAtaAddress(
        context,
        buyMintToUse,
        folio
      ),
      bidderSellTokenAccount: await getOrCreateAtaAddress(
        context,
        sellMintToUse,
        bidderKeypair.publicKey
      ),
      bidderBuyTokenAccount: await getOrCreateAtaAddress(
        context,
        buyMintToUse,
        bidderKeypair.publicKey
      ),
    })
    .remainingAccounts(remainingAccountsForCallback)
    .instruction();

  if (executeTxn) {
    return createAndProcessTransaction(client, bidderKeypair, [bid]) as any;
  }

  return { ix: bid, extraSigners: [] } as any;
}

export async function startFolioMigration<T extends boolean = true>(
  client: BanksClient,
  programFolio: Program<Folio>,
  folioOwnerKeypair: Keypair,
  folioTokenMint: PublicKey,
  oldFolio: PublicKey,
  newFolio: PublicKey,
  newFolioProgram: PublicKey,
  executeTxn: T = true as T
): Promise<
  T extends true
    ? BanksTransactionResultWithMeta
    : { ix: TransactionInstruction; extraSigners: any[] }
> {
  const startFolioMigration = await programFolio.methods
    .startFolioMigration()
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      folioOwner: folioOwnerKeypair.publicKey,
      programRegistrar: getProgramRegistrarPDA(),
      actor: getActorPDA(folioOwnerKeypair.publicKey, oldFolio),
      newFolioProgram,
      oldFolio,
      newFolio,
      folioTokenMint,
    })
    .instruction();

  if (executeTxn) {
    return createAndProcessTransaction(client, folioOwnerKeypair, [
      startFolioMigration,
    ]) as any;
  }

  return { ix: startFolioMigration, extraSigners: [] } as any;
}

export async function migrateFolioTokens<T extends boolean = true>(
  context: ProgramTestContext,
  client: BanksClient,
  programFolio: Program<Folio>,
  userKeypair: Keypair,
  oldFolio: PublicKey,
  newFolio: PublicKey,
  newFolioProgram: PublicKey,
  folioTokenMint: PublicKey,
  tokenMints: PublicKey[],
  executeTxn: T = true as T,
  remainingAccounts: AccountMeta[] = []
): Promise<
  T extends true
    ? BanksTransactionResultWithMeta
    : { ix: TransactionInstruction; extraSigners: any[] }
> {
  const migrateFolioTokens = await programFolio.methods
    .migrateFolioTokens()
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      user: userKeypair.publicKey,
      programRegistrar: getProgramRegistrarPDA(),
      newFolioProgram,
      oldFolio,
      oldFolioBasket: getFolioBasketPDA(oldFolio),
      newFolio,
      folioTokenMint,
    })
    .remainingAccounts(
      remainingAccounts.length > 0
        ? remainingAccounts
        : await buildRemainingAccountsForMigrateFolioTokens(
            context,
            userKeypair,
            oldFolio,
            newFolio,
            tokenMints
          )
    )
    .instruction();

  if (executeTxn) {
    return createAndProcessTransaction(client, userKeypair, [
      migrateFolioTokens,
    ]) as any;
  }

  return { ix: migrateFolioTokens, extraSigners: [] } as any;
}
