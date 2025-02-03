import { AccountMeta, Keypair, SystemProgram } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import { ProgramTestContext } from "solana-bankrun";
import {
  getActorPDAWithBump,
  getDaoFeeConfigPDAWithBump,
  getDtfSignerPDAWithBump,
  getFolioBasketPDAWithBump,
  getFolioFeeRecipientsPDAWithBump,
  getFolioPDAWithBump,
  getFolioRewardTokensPDA,
  getProgramDataPDA,
  getProgramRegistrarPDAWithBump,
  getRewardInfoPDA,
  getUserPendingBasketPDAWithBump,
  getUserRewardInfoPDA,
  getUserTokenRecordRealmsPDA,
} from "../../utils/pda-helper";
import { createFakeTokenOwnerRecordV2 } from "../../utils/data-helper";
import * as crypto from "crypto";
import { Folio } from "../../target/types/folio";
import { BN, Program } from "@coral-xyz/anchor";
import { Dtfs } from "../../target/types/dtfs";
import {
  FOLIO_PROGRAM_ID,
  MAX_CONCURRENT_TRADES,
  MAX_AUCTION_LENGTH,
  MAX_TRADE_DELAY,
  MIN_DAO_MINTING_FEE,
  MAX_FOLIO_FEE,
  SPL_GOVERNANCE_PROGRAM_ID,
  BPF_PROGRAM_USED_BY_BANKRUN,
  DTF_PROGRAM_ID,
  MAX_FOLIO_TOKEN_AMOUNTS,
  MAX_USER_PENDING_BASKET_TOKEN_AMOUNTS,
} from "../../utils/constants";
import { getOrCreateAtaAddress } from "./bankrun-token-helper";

export enum Role {
  Owner = 0b00000001, // 1
  TradeProposer = 0b00000010, // 2
  TradeLauncher = 0b00000100, // 4
  VibeOfficer = 0b00001000, // 8
}

// For anchor serialization
export function roleToStruct(role: Role) {
  return {
    [Role.Owner]: { owner: {} },
    [Role.TradeProposer]: { tradeProposer: {} },
    [Role.TradeLauncher]: { tradeLauncher: {} },
    [Role.VibeOfficer]: { vibeOfficer: {} },
  }[role];
}

export enum FolioStatus {
  Initializing = 0,
  Initialized = 1,
  Killed = 2,
}

export class FeeRecipient {
  receiver: PublicKey;
  portion: BN;

  constructor(receiver: PublicKey, portion: BN) {
    this.receiver = receiver;
    this.portion = portion;
  }
}

export class TokenAmount {
  public mint: PublicKey;
  public amountForMinting: BN;
  public amountForRedeeming: BN;

  constructor(mint: PublicKey, amountForMinting: BN, amountForRedeeming: BN) {
    this.mint = mint;
    this.amountForMinting = amountForMinting;
    this.amountForRedeeming = amountForRedeeming;
  }
}

export class MintInfo {
  mint: PublicKey;
  decimals: BN;
  supply: BN;
}

function getAccountDiscriminator(accountName: string): Buffer {
  const preimage = `account:${accountName}`;

  const hash = crypto.createHash("sha256").update(preimage).digest();

  return hash.slice(0, 8);
}

/*
External Accounts
*/
export function createGovernanceAccount(
  context: ProgramTestContext,
  userTokenRecordPda: PublicKey,
  depositAmount: number
) {
  const governanceAccountData = createFakeTokenOwnerRecordV2(
    depositAmount,
    Keypair.generate().publicKey,
    Keypair.generate().publicKey,
    Keypair.generate().publicKey,
    Keypair.generate().publicKey
  );

  context.setAccount(userTokenRecordPda, {
    lamports: 1_000_000_000,
    data: governanceAccountData,
    owner: SPL_GOVERNANCE_PROGRAM_ID,
    executable: false,
  });
}

export async function mockDTFProgramData(
  context: ProgramTestContext,
  programId: PublicKey,
  slot: BN
) {
  const programDataAddress = getProgramDataPDA(programId);

  // Mock Program Data Account
  const programDataAccountData = Buffer.alloc(45);
  programDataAccountData.writeInt32LE(3, 0); // variant 3 for ProgramData
  programDataAccountData.writeBigUInt64LE(BigInt(slot.toNumber()), 4);

  context.setAccount(programDataAddress, {
    executable: false,
    // Bankrun uses the non upgradeable loader
    owner: BPF_PROGRAM_USED_BY_BANKRUN,
    lamports: 1000000000,
    data: programDataAccountData,
  });

  return {
    programId,
    programDataAddress,
  };
}

export async function closeAccount(
  ctx: ProgramTestContext,
  accountAddress: PublicKey
) {
  ctx.setAccount(accountAddress, {
    lamports: 0,
    data: Buffer.alloc(0),
    executable: false,
    owner: SystemProgram.programId,
  });
}

/*
Folio Accounts
*/
export async function setFolioAccountInfo(
  ctx: ProgramTestContext,
  program: Program<Folio>,
  accountAddress: PublicKey,
  accountName: string,
  accountData: any,
  // For more complex structs with complex sub types and zero copy we might need to build the encoded account data manually
  preEncodedAccountData?: Buffer
) {
  const encodedAccountData =
    preEncodedAccountData ??
    (await program.coder.accounts.encode(accountName, accountData));

  const accountInfo = {
    lamports: 1_000_000_000,
    data: encodedAccountData,
    owner: FOLIO_PROGRAM_ID,
    executable: false,
  };

  ctx.setAccount(accountAddress, accountInfo);
}

export async function createAndSetProgramRegistrar(
  ctx: ProgramTestContext,
  program: Program<Folio>,
  acceptedPrograms: PublicKey[]
) {
  const programRegistrarPDAWithBump = getProgramRegistrarPDAWithBump();

  const programRegistrar = {
    bump: programRegistrarPDAWithBump[1],
    acceptedPrograms: acceptedPrograms.concat(
      Array(10 - acceptedPrograms.length).fill(PublicKey.default)
    ),
  };

  await setFolioAccountInfo(
    ctx,
    program,
    programRegistrarPDAWithBump[0],
    "programRegistrar",
    programRegistrar
  );
}

export async function createAndSetFolio(
  ctx: ProgramTestContext,
  program: Program<Folio>,
  folioTokenMint: PublicKey,
  programVersion: PublicKey,
  programDeploymentSlot: BN,
  status: FolioStatus = FolioStatus.Initialized,
  customFolioMintingFee: BN | null = null
) {
  const folioPDAWithBump = getFolioPDAWithBump(folioTokenMint);

  const folio = {
    bump: folioPDAWithBump[1],
    status: status,
    _padding: [0, 0, 0, 0, 0, 0],
    programVersion: programVersion,
    programDeploymentSlot: programDeploymentSlot,
    folioTokenMint: folioTokenMint,
    folioFee: MAX_FOLIO_FEE,
    mintingFee: customFolioMintingFee ?? MIN_DAO_MINTING_FEE,
    lastPoke: new BN(0),
    daoPendingFeeShares: new BN(0),
    feeRecipientsPendingFeeShares: new BN(0),
    tradeDelay: MAX_TRADE_DELAY,
    auctionLength: MAX_AUCTION_LENGTH,
    currentTradeId: new BN(0),
    tradeEnds: Array(MAX_CONCURRENT_TRADES).fill({
      mint: PublicKey.default,
      end_time: new BN(0),
    }),
  };

  await setFolioAccountInfo(ctx, program, folioPDAWithBump[0], "folio", folio);
}

export async function createAndSetActor(
  ctx: ProgramTestContext,
  program: Program<Folio>,
  actorKeypair: Keypair,
  folio: PublicKey,
  roles: number
) {
  const actorPDAWithBump = getActorPDAWithBump(actorKeypair.publicKey, folio);

  const actor = {
    bump: actorPDAWithBump[1],
    authority: actorKeypair.publicKey,
    folio: folio,
    roles: roles,
  };

  await setFolioAccountInfo(ctx, program, actorPDAWithBump[0], "actor", actor);
}

export async function createAndSetFeeRecipients(
  ctx: ProgramTestContext,
  program: Program<Folio>,
  folio: PublicKey,
  feeRecipientsInitial: FeeRecipient[]
) {
  const feeRecipientsPDAWithBump = getFolioFeeRecipientsPDAWithBump(folio);

  const feeRecipients = {
    bump: feeRecipientsPDAWithBump[1],
    _padding: [0, 0, 0, 0, 0, 0, 0],
    distributionIndex: new BN(0),
    folio: folio,
    fee_recipients: feeRecipientsInitial.map((fr) => ({
      receiver: fr.receiver,
      portion: fr.portion,
    })),
  };

  // Manual encoding for fee recipients
  const buffer = Buffer.alloc(2616);
  let offset = 0;

  // Encode discriminator
  const discriminator = getAccountDiscriminator("FeeRecipients");
  discriminator.copy(buffer, offset);
  offset += 8;

  // Encode bump
  buffer.writeUInt8(feeRecipients.bump, offset);
  offset += 1;

  // Encode padding
  feeRecipients._padding.forEach((pad: number) => {
    buffer.writeUInt8(pad, offset);
    offset += 1;
  });

  // Encode distribution_index
  buffer.writeBigUInt64LE(
    BigInt(feeRecipients.distributionIndex.toNumber()),
    offset // Start writing at the current offset
  );
  offset += 8;

  // Encode folio pubkey
  feeRecipients.folio.toBuffer().copy(buffer, offset);
  offset += 32;

  // Encode fee recipients
  feeRecipients.fee_recipients.forEach((fr: any) => {
    fr.receiver.toBuffer().copy(buffer, offset);
    offset += 32;
    fr.portion.toArrayLike(Buffer, "le", 8).copy(buffer, offset);
    offset += 8;
  });

  await setFolioAccountInfo(
    ctx,
    program,
    feeRecipientsPDAWithBump[0],
    "feeRecipients",
    feeRecipients,
    buffer
  );
}

export async function createAndSetFolioBasket(
  ctx: ProgramTestContext,
  program: Program<Folio>,
  folio: PublicKey,
  tokenAmounts: TokenAmount[]
) {
  const folioBasketPDAWithBump = getFolioBasketPDAWithBump(folio);

  const folioBasket = {
    bump: folioBasketPDAWithBump[1],
    _padding: [0, 0, 0, 0, 0, 0, 0],
    folio: folio,
    tokenAmounts: tokenAmounts,
  };

  const buffer = Buffer.alloc(816);
  let offset = 0;

  // Encode discriminator
  const discriminator = getAccountDiscriminator("FolioBasket");
  discriminator.copy(buffer, offset);
  offset += 8;

  // Encode bump
  buffer.writeUInt8(folioBasket.bump, offset);
  offset += 1;

  // Encode padding
  folioBasket._padding.forEach((pad: number) => {
    buffer.writeUInt8(pad, offset);
    offset += 1;
  });

  // Encode folio pubkey
  folioBasket.folio.toBuffer().copy(buffer, offset);
  offset += 32;

  // Encode token amounts
  // Encode token amounts
  for (let i = 0; i < MAX_FOLIO_TOKEN_AMOUNTS; i++) {
    const tokenAmount = folioBasket.tokenAmounts[i] || {
      mint: PublicKey.default,
      amountForMinting: new BN(0),
      amountForRedeeming: new BN(0),
    };

    tokenAmount.mint.toBuffer().copy(buffer, offset);
    offset += 32;
    tokenAmount.amountForMinting
      .toArrayLike(Buffer, "le", 8)
      .copy(buffer, offset);
    offset += 8;
    tokenAmount.amountForRedeeming
      .toArrayLike(Buffer, "le", 8)
      .copy(buffer, offset);
    offset += 8;
  }

  await setFolioAccountInfo(
    ctx,
    program,
    folioBasketPDAWithBump[0],
    "folioBasket",
    folioBasket,
    buffer
  );
}

export async function createAndSetUserPendingBasket(
  ctx: ProgramTestContext,
  program: Program<Folio>,
  folio: PublicKey,
  owner: PublicKey,
  tokenAmounts: TokenAmount[]
) {
  const userPendingBasketPDAWithBump = getUserPendingBasketPDAWithBump(
    folio,
    owner
  );

  const userPendingBasket = {
    bump: userPendingBasketPDAWithBump[1],
    _padding: [0, 0, 0, 0, 0, 0, 0],
    owner: owner,
    folio: folio,
    tokenAmounts: tokenAmounts,
  };

  const buffer = Buffer.alloc(1040);
  let offset = 0;

  // Encode discriminator
  const discriminator = getAccountDiscriminator("UserPendingBasket");
  discriminator.copy(buffer, offset);
  offset += 8;

  // Encode bump
  buffer.writeUInt8(userPendingBasket.bump, offset);
  offset += 1;

  // Encode padding
  userPendingBasket._padding.forEach((pad: number) => {
    buffer.writeUInt8(pad, offset);
    offset += 1;
  });

  // Encode owner pubkey
  userPendingBasket.owner.toBuffer().copy(buffer, offset);
  offset += 32;

  // Encode folio pubkey
  userPendingBasket.folio.toBuffer().copy(buffer, offset);
  offset += 32;

  // Encode token amounts
  for (let i = 0; i < MAX_USER_PENDING_BASKET_TOKEN_AMOUNTS; i++) {
    const tokenAmount = userPendingBasket.tokenAmounts[i] || {
      mint: PublicKey.default,
      amountForMinting: new BN(0),
      amountForRedeeming: new BN(0),
    };

    tokenAmount.mint.toBuffer().copy(buffer, offset);
    offset += 32;
    tokenAmount.amountForMinting
      .toArrayLike(Buffer, "le", 8)
      .copy(buffer, offset);
    offset += 8;
    tokenAmount.amountForRedeeming
      .toArrayLike(Buffer, "le", 8)
      .copy(buffer, offset);
    offset += 8;
  }

  await setFolioAccountInfo(
    ctx,
    program,
    userPendingBasketPDAWithBump[0],
    "userPendingBasket",
    userPendingBasket,
    buffer
  );
}

/*
DTF Accounts
*/
export async function setDTFAccountInfo(
  ctx: ProgramTestContext,
  program: Program<Dtfs>,
  accountAddress: PublicKey,
  accountName: string,
  accountData: any,
  preEncodedAccountData?: Buffer
) {
  const encodedAccountData =
    preEncodedAccountData ??
    (await program.coder.accounts.encode(accountName, accountData));

  ctx.setAccount(accountAddress, {
    lamports: 1_000_000_000,
    data: encodedAccountData,
    owner: DTF_PROGRAM_ID,
    executable: false,
  });
}

export async function createAndSetDTFProgramSigner(
  ctx: ProgramTestContext,
  program: Program<Dtfs>
) {
  const dtfProgramSigner = getDtfSignerPDAWithBump();

  const dtfProgramSignerData = {
    bump: dtfProgramSigner[1],
  };

  await setDTFAccountInfo(
    ctx,
    program,
    dtfProgramSigner[0],
    "dtfProgramSigner",
    dtfProgramSignerData
  );
}

export async function createAndSetDaoFeeConfig(
  ctx: ProgramTestContext,
  program: Program<Dtfs>,
  feeRecipient: PublicKey,
  feeNumerator: BN
) {
  const daoFeeConfigPDAWithBump = getDaoFeeConfigPDAWithBump();
  const daoFeeConfig = {
    bump: daoFeeConfigPDAWithBump[1],
    feeRecipient,
    feeNumerator,
  };

  const buffer = Buffer.alloc(57);
  let offset = 0;
  // Encode discriminator
  const discriminator = getAccountDiscriminator("DAOFeeConfig");
  discriminator.copy(buffer, offset);
  offset += 8;

  // Encode bump
  buffer.writeUInt8(daoFeeConfig.bump, offset);
  offset += 1;

  // Encode owner pubkey
  daoFeeConfig.feeRecipient.toBuffer().copy(buffer, offset);
  offset += 32;

  // Encode fee numerator
  const value = BigInt(daoFeeConfig.feeNumerator.toString());
  buffer.writeBigUInt64LE(BigInt(value & BigInt("0xFFFFFFFFFFFFFFFF")), offset);
  offset += 8;
  buffer.writeBigUInt64LE(BigInt(value >> BigInt(64)), offset);
  offset += 8;

  await setDTFAccountInfo(
    ctx,
    program,
    daoFeeConfigPDAWithBump[0],
    "daoFeeConfig",
    daoFeeConfig,
    buffer
  );
}

/*
Remaining Accounts Helper
*/

export function getInvalidRemainingAccounts(size: number): AccountMeta[] {
  return Array(size)
    .fill(null)
    .map(() => ({
      pubkey: Keypair.generate().publicKey,
      isSigner: false,
      isWritable: false,
    }));
}

export async function buildRemainingAccounts(
  context: ProgramTestContext,
  tokens: { mint: PublicKey; amount: BN }[],
  senderAddress: PublicKey = null,
  receiverAddress: PublicKey = null,
  includeMint: boolean = true
): Promise<AccountMeta[]> {
  const remainingAccounts: AccountMeta[] = [];

  for (const token of tokens) {
    if (includeMint) {
      remainingAccounts.push({
        pubkey: token.mint,
        isSigner: false,
        isWritable: false,
      });
    }
    if (senderAddress) {
      remainingAccounts.push({
        pubkey: await getOrCreateAtaAddress(context, token.mint, senderAddress),
        isSigner: false,
        isWritable: true,
      });
    }
    if (receiverAddress) {
      remainingAccounts.push({
        pubkey: await getOrCreateAtaAddress(
          context,
          token.mint,
          receiverAddress
        ),
        isSigner: false,
        isWritable: true,
      });
    }
  }

  return remainingAccounts;
}

export async function buildRemainingAccountsForAccruesRewards(
  context: ProgramTestContext,
  callerKeypair: Keypair,
  folio: PublicKey,
  folioOwner: PublicKey, // Is the realm
  rewardTokens: PublicKey[],
  extraUser: PublicKey = callerKeypair.publicKey
): Promise<AccountMeta[]> {
  const remainingAccounts: AccountMeta[] = [];

  const folioRewardTokensPDA = getFolioRewardTokensPDA(folio);

  for (const token of rewardTokens) {
    remainingAccounts.push({
      pubkey: token,
      isSigner: false,
      isWritable: false,
    });

    remainingAccounts.push({
      pubkey: getRewardInfoPDA(folio, token),
      isSigner: false,
      isWritable: true,
    });

    remainingAccounts.push({
      pubkey: await getOrCreateAtaAddress(context, token, folioRewardTokensPDA),
      isSigner: false,
      isWritable: false,
    });

    remainingAccounts.push({
      pubkey: getUserRewardInfoPDA(folio, token, callerKeypair.publicKey),
      isSigner: false,
      isWritable: true,
    });

    remainingAccounts.push({
      pubkey: getUserTokenRecordRealmsPDA(
        folioOwner,
        token,
        callerKeypair.publicKey
      ),
      isSigner: false,
      isWritable: false,
    });

    if (extraUser.toString() !== callerKeypair.publicKey.toString()) {
      remainingAccounts.push({
        pubkey: getUserRewardInfoPDA(folio, token, extraUser),
        isSigner: false,
        isWritable: true,
      });
      remainingAccounts.push({
        pubkey: getUserTokenRecordRealmsPDA(folioOwner, token, extraUser),
        isSigner: false,
        isWritable: false,
      });
    }
  }

  return remainingAccounts;
}

export async function buildRemainingAccountsForClaimRewards(
  context: ProgramTestContext,
  callerKeypair: Keypair,
  folio: PublicKey,
  rewardTokens: PublicKey[]
): Promise<AccountMeta[]> {
  const remainingAccounts: AccountMeta[] = [];

  const folioRewardTokensPDA = getFolioRewardTokensPDA(folio);

  for (const token of rewardTokens) {
    remainingAccounts.push({
      pubkey: token,
      isSigner: false,
      isWritable: false,
    });

    remainingAccounts.push({
      pubkey: await getOrCreateAtaAddress(context, token, folioRewardTokensPDA),
      isSigner: false,
      isWritable: true,
    });

    remainingAccounts.push({
      pubkey: getRewardInfoPDA(folio, token),
      isSigner: false,
      isWritable: true,
    });

    remainingAccounts.push({
      pubkey: getUserRewardInfoPDA(folio, token, callerKeypair.publicKey),
      isSigner: false,
      isWritable: true,
    });

    remainingAccounts.push({
      pubkey: await getOrCreateAtaAddress(
        context,
        token,
        callerKeypair.publicKey
      ),
      isSigner: false,
      isWritable: true,
    });
  }

  return remainingAccounts;
}
