import { createAndProcessTransaction } from "./bankrun-program-helper";
import {
  getActorPDA,
  getDAOFeeConfigPDA,
  getFeeDistributionPDA,
  getFolioBasketPDA,
  getTVLFeeRecipientsPDA,
  getFolioPDA,
  getMetadataPDA,
  getProgramRegistrarPDA,
  getRewardInfoPDA,
  getUserPendingBasketPDA,
  getFolioFeeConfigPDA,
  getRewardTokensPDA,
  getAuctionEndsPDA,
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
  REWARDS_PROGRAM_ID,
  SPL_GOVERNANCE_PROGRAM_ID,
  TOKEN_METADATA_PROGRAM_ID,
} from "../../utils/constants";
import {
  buildRemainingAccounts,
  buildRemainingAccountsForClaimRewards,
  buildRemainingAccountsForMigrateFolioTokens,
  roleToStruct,
  buildRemainingAccountsForAccruesRewards,
  buildRemainingAccountsForUpdateFolio,
  buildRemainingAccountsForStartFolioMigration,
} from "./bankrun-account-helper";
import { getOrCreateAtaAddress } from "./bankrun-token-helper";
import { FolioAdmin } from "../../target/types/folio_admin";
import { SplGovernance } from "governance-idl-sdk";
import { Rewards } from "../../target/types/rewards";

/**
Helper functions to create the instructions for calling the different programs.

They all follow the same pattern:
  - Takes in a generic parameter `T` that defaults to `true`, which is used to determine
    if the function should process the transaction or just build and return it.
    This works in conjunction with executeTxn: T = true as T

Some of the functions also require more compute units, so we add them as extra instructions
to the transaction.
*/

/*
Folio Admin
*/
export async function setDaoFeeConfig<T extends boolean = true>(
  client: BanksClient,
  programFolioAdmin: Program<FolioAdmin>,
  adminKeypair: Keypair,
  feeRecipient: PublicKey,
  feeNumerator: BN,
  feeFloor: BN,
  executeTxn: T = true as T
): Promise<
  T extends true
    ? BanksTransactionResultWithMeta
    : { ix: TransactionInstruction; extraSigners: any[] }
> {
  const ix = await programFolioAdmin.methods
    .setDaoFeeConfig(feeRecipient, feeNumerator, feeFloor)
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

export async function setFolioFeeConfig<T extends boolean = true>(
  client: BanksClient,
  programFolioAdmin: Program<FolioAdmin>,
  adminKeypair: Keypair,
  folio: PublicKey,
  folioTokenMint: PublicKey,
  feeNumerator: BN,
  feeFloor: BN,
  feeRecipient: PublicKey,
  executeTxn: T = true as T
): Promise<
  T extends true
    ? BanksTransactionResultWithMeta
    : { ix: TransactionInstruction; extraSigners: any[] }
> {
  const ix = await programFolioAdmin.methods
    .setFolioFeeConfig(feeNumerator, feeFloor)
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
      tokenProgram: TOKEN_PROGRAM_ID,
      admin: !executeTxn ? OTHER_ADMIN_KEY.publicKey : adminKeypair.publicKey,
      daoFeeConfig: getDAOFeeConfigPDA(),
      folioTokenMint: folioTokenMint,
      folio: folio,
      folioFeeConfig: getFolioFeeConfigPDA(folio),
      folioProgram: FOLIO_PROGRAM_ID,
      feeRecipients: getTVLFeeRecipientsPDA(folio),
      feeDistribution: getFeeDistributionPDA(folio, new BN(1)),
      daoFeeRecipient: feeRecipient,
    })
    .instruction();

  if (executeTxn) {
    return createAndProcessTransaction(client, adminKeypair, [
      ...getComputeLimitInstruction(1_200_000),
      ix,
    ]) as any;
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

export async function updateFolio<T extends boolean = true>(
  context: ProgramTestContext,
  client: BanksClient,
  programFolio: Program<Folio>,
  folioOwnerKeypair: Keypair,
  folio: PublicKey,
  folioTokenMint: PublicKey,
  daoFeeRecipient: PublicKey,
  tvlFee: BN | null,
  indexForFeeDistribution: BN | null,
  mintFee: BN | null,
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
      indexForFeeDistribution,
      mintFee,
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
    .remainingAccounts(
      await buildRemainingAccountsForUpdateFolio(
        context,
        folio,
        folioTokenMint,
        daoFeeRecipient
      )
    )
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
  folioTokenMint: PublicKey,
  tokenToRemove: PublicKey,
  executeTxn: T = true as T
): Promise<
  T extends true
    ? BanksTransactionResultWithMeta
    : { ix: TransactionInstruction; extraSigners: any[] }
> {
  const removeFromBasket = await programFolio.methods
    .removeFromBasket()
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      folioOwner: !executeTxn
        ? OTHER_ADMIN_KEY.publicKey
        : folioOwnerKeypair.publicKey,
      actor: getActorPDA(folioOwnerKeypair.publicKey, folio),

      folio: folio,
      folioBasket: getFolioBasketPDA(folio),
      folioTokenMint: folioTokenMint,
      tokenMint: tokenToRemove,
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
  minRawShares: BN | null = null
) {
  const mintFolioToken = await programFolio.methods
    .mintFolioToken(shares, minRawShares)
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      user: userKeypair.publicKey,
      daoFeeConfig: getDAOFeeConfigPDA(),
      folioFeeConfig: getFolioFeeConfigPDA(folio),
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
  executeTxn: T = true as T
) {
  const burnFolioTokenIx = await programFolio.methods
    .burnFolioToken(amountToBurn)
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      user: userKeypair.publicKey,
      daoFeeConfig: getDAOFeeConfigPDA(),
      folioFeeConfig: getFolioFeeConfigPDA(folio),
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
      folioFeeConfig: getFolioFeeConfigPDA(folioPDA),
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
      folioFeeConfig: getFolioFeeConfigPDA(folio),
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
  remainingAccounts: AccountMeta[] = [],
  newFolio: PublicKey = null,
  newFolioProgram: PublicKey = null,
  programRegistrar: PublicKey = null
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
      // Can be null
      upgradedFolio: newFolio,
      upgradedFolioProgram: newFolioProgram,
      programRegistrar,
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

export async function startRebalance<T extends boolean = true>(
  client: BanksClient,
  programFolio: Program<Folio>,
  rebalanceManagerKeypair: Keypair,
  folio: PublicKey,
  folioTokenMint: PublicKey,
  auctionLauncherWindow: BN | number,
  ttl: BN | number,
  pricesAndLimits: {
    prices: { low: BN; high: BN };
    limits: { spot: BN; low: BN; high: BN };
  }[],
  allRebalanceDetailsAdded: boolean,
  mints: PublicKey[],
  executeTxn: T = true as T
): Promise<
  T extends true
    ? BanksTransactionResultWithMeta
    : { ix: TransactionInstruction; extraSigners: any[] }
> {
  const remainingAccounts = mints.map((mint) => {
    return {
      isWritable: false,
      isSigner: false,
      pubkey: mint,
    };
  });
  const startRebalance = await programFolio.methods
    .startRebalance(
      new BN(auctionLauncherWindow.toString()),
      new BN(ttl.toString()),
      pricesAndLimits,
      allRebalanceDetailsAdded
    )
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      rebalanceManager: rebalanceManagerKeypair.publicKey,
      actor: getActorPDA(rebalanceManagerKeypair.publicKey, folio),
      folio,
      folioTokenMint,
    })
    .remainingAccounts(remainingAccounts)
    .instruction();

  if (executeTxn) {
    return createAndProcessTransaction(client, rebalanceManagerKeypair, [
      startRebalance,
    ]) as any;
  }

  return { ix: startRebalance, extraSigners: [] } as any;
}

export async function addRebalanceDetails<T extends boolean = true>(
  client: BanksClient,
  programFolio: Program<Folio>,
  rebalanceManagerKeypair: Keypair,
  folio: PublicKey,
  pricesAndLimits: {
    prices: { low: BN; high: BN };
    limits: { spot: BN; low: BN; high: BN };
  }[],
  allRebalanceDetailsAdded: boolean,
  mints: PublicKey[],
  executeTxn: T = true as T
): Promise<
  T extends true
    ? BanksTransactionResultWithMeta
    : { ix: TransactionInstruction; extraSigners: any[] }
> {
  const remainingAccounts = mints.map((mint) => {
    return {
      isWritable: false,
      isSigner: false,
      pubkey: mint,
    };
  });
  const addRebalanceDetails = await programFolio.methods
    .addRebalanceDetails(pricesAndLimits, allRebalanceDetailsAdded)
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      rebalanceManager: rebalanceManagerKeypair.publicKey,
      actor: getActorPDA(rebalanceManagerKeypair.publicKey, folio),
      folio,
    })
    .remainingAccounts(remainingAccounts)
    .instruction();

  if (executeTxn) {
    return createAndProcessTransaction(client, rebalanceManagerKeypair, [
      addRebalanceDetails,
    ]) as any;
  }

  return { ix: startRebalance, extraSigners: [] } as any;
}

export async function openAuction<T extends boolean = true>(
  client: BanksClient,
  programFolio: Program<Folio>,
  auctionLauncherKeypair: Keypair,
  folio: PublicKey,
  folioTokenMint: PublicKey,
  rebalanceNonce: BN,
  auction: PublicKey,
  auctionData: {
    sellLimitSpot: BN;
    buyLimitSpot: BN;
    prices: {
      start: BN;
      end: BN;
    };
  },
  sellMint: PublicKey,
  buyMint: PublicKey,
  executeTxn: T = true as T
): Promise<
  T extends true
    ? BanksTransactionResultWithMeta
    : { ix: TransactionInstruction; extraSigners: any[] }
> {
  const compare = new PublicKey(sellMint)
    .toBuffer()
    .compare(new PublicKey(buyMint).toBuffer());
  let token1, token2: PublicKey;
  if (compare < 0) {
    token1 = sellMint;
    token2 = buyMint;
  } else {
    token1 = buyMint;
    token2 = sellMint;
  }

  const openAuction = await programFolio.methods
    .openAuction(
      token1,
      token2,
      auctionData.sellLimitSpot,
      auctionData.buyLimitSpot,
      auctionData.prices.start,
      auctionData.prices.end
    )
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      auctionLauncher: auctionLauncherKeypair.publicKey,
      actor: getActorPDA(auctionLauncherKeypair.publicKey, folio),
      folio,
      auction,
      sellMint,
      buyMint,
      folioTokenMint,
      auctionEnds: getAuctionEndsPDA(folio, rebalanceNonce, sellMint, buyMint),
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
  folioTokenMint: PublicKey,
  rebalanceNonce: BN,
  auction: PublicKey,
  sellMint: PublicKey,
  buyMint: PublicKey,
  executeTxn: T = true as T
): Promise<
  T extends true
    ? BanksTransactionResultWithMeta
    : { ix: TransactionInstruction; extraSigners: any[] }
> {
  const compare = new PublicKey(sellMint)
    .toBuffer()
    .compare(new PublicKey(buyMint).toBuffer());
  let token1, token2: PublicKey;
  if (compare < 0) {
    token1 = sellMint;
    token2 = buyMint;
  } else {
    token1 = buyMint;
    token2 = sellMint;
  }
  const openAuctionPermissionless = await programFolio.methods
    .openAuctionPermissionless(token1, token2)
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      user: userKeypair.publicKey,
      folio,
      auction,
      sellMint,
      buyMint,
      folioTokenMint,
      auctionEnds: getAuctionEndsPDA(folio, rebalanceNonce, sellMint, buyMint),
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
  nonce: BN,
  sellMint: PublicKey,
  buyMint: PublicKey,
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
      auctionEnds: getAuctionEndsPDA(folio, nonce, sellMint, buyMint),
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
  rebalanceNonce: BN,
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

  const sellMintToUse = sellMint ?? auctionFetched.sellMint;
  const buyMintToUse = buyMint ?? auctionFetched.buyMint;

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
      auctionEnds: getAuctionEndsPDA(
        folio,
        rebalanceNonce,
        sellMintToUse,
        buyMintToUse
      ),
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
    return createAndProcessTransaction(client, bidderKeypair, [
      ...getComputeLimitInstruction(400_000),
      bid,
    ]) as any;
  }

  return { ix: bid, extraSigners: [] } as any;
}

export async function startFolioMigration<T extends boolean = true>(
  context: ProgramTestContext,
  client: BanksClient,
  programFolio: Program<Folio>,
  folioOwnerKeypair: Keypair,
  folioTokenMint: PublicKey,
  oldFolio: PublicKey,
  newFolio: PublicKey,
  newFolioProgram: PublicKey,
  indexForFeeDistribution: BN,
  daoFeeRecipient: PublicKey,
  executeTxn: T = true as T
): Promise<
  T extends true
    ? BanksTransactionResultWithMeta
    : { ix: TransactionInstruction; extraSigners: any[] }
> {
  const startFolioMigration = await programFolio.methods
    .startFolioMigration(indexForFeeDistribution)
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
    .remainingAccounts(
      await buildRemainingAccountsForStartFolioMigration(
        context,
        oldFolio,
        folioTokenMint,
        daoFeeRecipient
      )
    )
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

/*
Rewards instructions
*/

/*
Expected to be called via the spl governance program
*/
export async function setRewardsAdmin<T extends boolean = true>(
  client: BanksClient,
  programRewards: Program<Rewards>,
  executor: Keypair,
  // Is a governance account
  rewardAdmin: PublicKey,
  realm: PublicKey,
  executeTxn: T = true as T
): Promise<
  T extends true
    ? BanksTransactionResultWithMeta
    : { ix: TransactionInstruction; extraSigners: any[] }
> {
  const setRewardsAdmin = await programRewards.methods
    .setRewardsAdmin()
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      executor: executor.publicKey,
      rewardAdmin,
      realm,
      rewardTokens: getRewardTokensPDA(realm),
    })
    .instruction();

  if (executeTxn) {
    return createAndProcessTransaction(client, executor, [
      setRewardsAdmin,
    ]) as any;
  }

  return { ix: setRewardsAdmin, extraSigners: [] } as any;
}

export async function addRewardToken<T extends boolean = true>(
  context: ProgramTestContext,
  client: BanksClient,
  programRewards: Program<Rewards>,
  executor: Keypair,
  // Is a governance account
  rewardAdmin: PublicKey,
  realm: PublicKey,
  rewardToken: PublicKey,
  executeTxn: T = true as T,
  rewardTokenATA: PublicKey = null
): Promise<
  T extends true
    ? BanksTransactionResultWithMeta
    : { ix: TransactionInstruction; extraSigners: any[] }
> {
  const addRewardToken = await programRewards.methods
    .addRewardToken()
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      executor: executor.publicKey,
      rewardAdmin,
      realm,
      rewardTokens: getRewardTokensPDA(realm),
      rewardTokenRewardInfo: getRewardInfoPDA(realm, rewardToken),
      rewardToken,
      rewardTokenAccount:
        rewardTokenATA ??
        (await getOrCreateAtaAddress(
          context,
          rewardToken,
          getRewardTokensPDA(realm)
        )),
    })
    .instruction();

  if (executeTxn) {
    return createAndProcessTransaction(client, executor, [
      ...getComputeLimitInstruction(800_000),
      addRewardToken,
    ]) as any;
  }

  return { ix: addRewardToken, extraSigners: [] } as any;
}

/*
Expected to be called via the spl governance program
*/
export async function removeRewardToken<T extends boolean = true>(
  client: BanksClient,
  programRewards: Program<Rewards>,
  executor: Keypair,
  // Is a governance account
  rewardAdmin: PublicKey,
  realm: PublicKey,
  rewardTokenToRemove: PublicKey,

  executeTxn: T = true as T
): Promise<
  T extends true
    ? BanksTransactionResultWithMeta
    : { ix: TransactionInstruction; extraSigners: any[] }
> {
  const removeRewardToken = await programRewards.methods
    .removeRewardToken()
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      executor: executor.publicKey,
      rewardAdmin,
      realm,
      rewardTokens: getRewardTokensPDA(realm),
      rewardTokenToRemove,
    })
    .instruction();

  if (executeTxn) {
    return createAndProcessTransaction(client, executor, [
      removeRewardToken,
    ]) as any;
  }

  return { ix: removeRewardToken, extraSigners: [] } as any;
}

/*
Expected to be called via the spl governance program
*/
export async function initOrSetRewardRatio<T extends boolean = true>(
  client: BanksClient,
  programRewards: Program<Rewards>,
  executor: Keypair,
  // Is a governance account
  rewardAdmin: PublicKey,
  realm: PublicKey,
  governanceTokenMint: PublicKey,
  governanceStakedTokenAccount: PublicKey,
  callerGovernanceTokenAccount: PublicKey,
  rewardPeriod: BN,
  executeTxn: T = true as T
): Promise<
  T extends true
    ? BanksTransactionResultWithMeta
    : { ix: TransactionInstruction; extraSigners: any[] }
> {
  const initOrSetRewardRatio = await programRewards.methods
    .initOrSetRewardRatio(rewardPeriod)
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      executor: executor.publicKey,
      rewardAdmin,
      realm,
      rewardTokens: getRewardTokensPDA(realm),
      governanceTokenMint,
      governanceStakedTokenAccount,
      callerGovernanceTokenAccount,
    })
    .instruction();

  if (executeTxn) {
    return createAndProcessTransaction(client, executor, [
      initOrSetRewardRatio,
    ]) as any;
  }

  return { ix: initOrSetRewardRatio, extraSigners: [] } as any;
}

export async function accrueRewards<T extends boolean = true>(
  client: BanksClient,
  programRewards: Program<Rewards>,
  callerKeypair: Keypair,
  realm: PublicKey,
  governanceMint: PublicKey,
  governanceHoldingTokenAccount: PublicKey,
  callerGovernanceTokenAccount: PublicKey,
  userGovernanceTokenAccount: PublicKey,
  extraUser: PublicKey = callerKeypair.publicKey,
  executeTxn: T = true as T,
  remainingAccounts: AccountMeta[] = []
): Promise<
  T extends true
    ? BanksTransactionResultWithMeta
    : { ix: TransactionInstruction; extraSigners: any[] }
> {
  const accrueRewards = await programRewards.methods
    .accrueRewards()
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      caller: callerKeypair.publicKey,
      realm,
      rewardTokens: getRewardTokensPDA(realm),
      governanceTokenMint: governanceMint,
      governanceStakedTokenAccount: governanceHoldingTokenAccount,
      callerGovernanceTokenAccount,
      userGovernanceTokenAccount,
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
  programRewards: Program<Rewards>,
  userKeypair: Keypair,
  realm: PublicKey,
  governanceTokenMint: PublicKey,
  governanceStakedTokenAccount: PublicKey,
  callerGovernanceTokenAccount: PublicKey,
  rewardTokens: PublicKey[],
  executeTxn: T = true as T,
  remainingAccounts: AccountMeta[] = []
): Promise<
  T extends true
    ? BanksTransactionResultWithMeta
    : { ix: TransactionInstruction; extraSigners: any[] }
> {
  const claimRewards = await programRewards.methods
    .claimRewards()
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      user: userKeypair.publicKey,
      realm,
      rewardTokens: getRewardTokensPDA(realm),
      governanceTokenMint,
      governanceStakedTokenAccount,
      callerGovernanceTokenAccount,
    })
    .remainingAccounts(
      remainingAccounts.length > 0
        ? remainingAccounts
        : await buildRemainingAccountsForClaimRewards(
            context,
            userKeypair,
            realm,
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

/*
Governance instructions
*/

function getGovernanceClient(programRewards: Program<Rewards>) {
  return new SplGovernance(
    programRewards.provider.connection as any,
    SPL_GOVERNANCE_PROGRAM_ID
  );
}

async function buildGovernanceAccrueRewardsRemainingAccounts(
  context: ProgramTestContext,
  userKeypair: Keypair,
  realm: PublicKey,
  governanceTokenMint: PublicKey,
  rewardTokens: PublicKey[],
  withSystemProgram: boolean = true
) {
  const remainingAccounts: AccountMeta[] = [];

  /* Order is
   *
   * system_program (if needed)
   * rewards_program_info
   * rewards_reward_tokens
   * governance_token_mint
   * reward token accounts
   */

  if (withSystemProgram) {
    remainingAccounts.push({
      pubkey: SystemProgram.programId,
      isSigner: false,
      isWritable: false,
    });
  }

  remainingAccounts.push({
    pubkey: REWARDS_PROGRAM_ID,
    isSigner: false,
    isWritable: false,
  });

  remainingAccounts.push({
    pubkey: getRewardTokensPDA(realm),
    isSigner: false,
    isWritable: false,
  });

  remainingAccounts.push({
    pubkey: governanceTokenMint,
    isSigner: false,
    isWritable: false,
  });

  remainingAccounts.push(
    ...(await buildRemainingAccountsForAccruesRewards(
      context,
      userKeypair,
      realm,
      rewardTokens
    ))
  );

  return remainingAccounts;
}

export async function depositLiquidityToGovernance(
  context: ProgramTestContext,
  programRewards: Program<Rewards>,
  userKeypair: Keypair,
  realm: PublicKey,
  governanceTokenMint: PublicKey,
  userATA: PublicKey,
  rewardTokens: PublicKey[],
  amount: BN
): Promise<BanksTransactionResultWithMeta> {
  const depositIx = await getGovernanceClient(
    programRewards
  ).depositGoverningTokensInstruction(
    realm,
    governanceTokenMint,
    userATA,
    userKeypair.publicKey,
    userKeypair.publicKey,
    userKeypair.publicKey,
    amount
  );

  depositIx.keys.push(
    ...(await buildGovernanceAccrueRewardsRemainingAccounts(
      context,
      userKeypair,
      realm,
      governanceTokenMint,
      rewardTokens,
      false
    ))
  );

  return createAndProcessTransaction(context.banksClient, userKeypair, [
    ...getComputeLimitInstruction(700_000),
    depositIx,
  ]);
}

export async function withdrawLiquidityFromGovernance(
  context: ProgramTestContext,
  programRewards: Program<Rewards>,
  userKeypair: Keypair,
  realm: PublicKey,
  governanceTokenMint: PublicKey,
  userATA: PublicKey,
  rewardTokens: PublicKey[]
): Promise<BanksTransactionResultWithMeta> {
  const withdrawIx = await getGovernanceClient(
    programRewards
  ).withdrawGoverningTokensInstruction(
    realm,
    governanceTokenMint,
    userATA,
    userKeypair.publicKey
  );

  withdrawIx.keys.push(
    ...(await buildGovernanceAccrueRewardsRemainingAccounts(
      context,
      userKeypair,
      realm,
      governanceTokenMint,
      rewardTokens,
      true
    ))
  );

  return createAndProcessTransaction(context.banksClient, userKeypair, [
    ...getComputeLimitInstruction(800_000),
    withdrawIx,
  ]);
}
