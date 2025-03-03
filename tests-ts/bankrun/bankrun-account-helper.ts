import { AccountMeta, Keypair, SystemProgram } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import { ProgramTestContext } from "solana-bankrun";
import {
  getActorPDAWithBump,
  getDaoFeeConfigPDAWithBump,
  getFeeDistributionPDAWithBump,
  getFolioBasketPDAWithBump,
  getTVLFeeRecipientsPDAWithBump,
  getFolioPDAWithBump,
  getFolioRewardTokensPDA,
  getFolioRewardTokensPDAWithBump,
  getProgramRegistrarPDAWithBump,
  getRewardInfoPDA,
  getRewardInfoPDAWithBump,
  getAuctionPDAWithBump,
  getUserPendingBasketPDAWithBump,
  getUserRewardInfoPDA,
  getUserRewardInfoPDAWithBump,
  getFolioFeeConfigPDAWithBump,
  getDAOFeeConfigPDA,
  getFolioFeeConfigPDA,
  getFeeDistributionPDA,
} from "../../utils/pda-helper";
import * as crypto from "crypto";
import { Folio } from "../../target/types/folio";
import { BN, Program } from "@coral-xyz/anchor";
import { FolioAdmin } from "../../target/types/folio_admin";
import { Folio as FolioSecond } from "../../target/types/second_folio";
import {
  MAX_CONCURRENT_AUCTIONS,
  MAX_AUCTION_LENGTH,
  MAX_AUCTION_DELAY,
  MAX_FOLIO_TOKEN_AMOUNTS,
  MAX_USER_PENDING_BASKET_TOKEN_AMOUNTS,
  MAX_REWARD_TOKENS,
  FOLIO_ADMIN_PROGRAM_ID,
  MAX_MINT_FEE,
  EXPECTED_TVL_FEE_WHEN_MAX,
  MAX_FEE_FLOOR,
  MAX_PADDED_STRING_LENGTH,
} from "../../utils/constants";
import { getOrCreateAtaAddress } from "./bankrun-token-helper";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

/**
 * Helper functions for creating and setting accounts in the Bankrun environment.
 * Some of the function use manual serialization (especially for more complex structs),
 * as it was causing issues when try to let anchor handle it.
 *
 * Most of the functions are HIGHLY linked to our program's state structs,
 * so make sure to update them if the structs change.
 *
 * Those changes include:
 *  - Size of the accounts:
 *    - i.e.: const buffer = Buffer.alloc(296);
 *  - Changes in the structs:
 *    - If the structs change, the account data will not be serialized correctly.
 *  - Changes in the enums:
 *    - If the enums change, the account data will not be serialized correctly.
 */

export enum Role {
  Owner = 0b00000001, // 1
  AuctionApprover = 0b00000010, // 2
  AuctionLauncher = 0b00000100, // 4
  BrandManager = 0b00001000, // 8
}

// For anchor serialization, anchor's enums are sent using {enumValue: {}}
export function roleToStruct(role: Role) {
  return {
    [Role.Owner]: { owner: {} },
    [Role.AuctionApprover]: { auctionApprover: {} },
    [Role.AuctionLauncher]: { auctionLauncher: {} },
    [Role.BrandManager]: { brandManager: {} },
  }[role];
}

export enum FolioStatus {
  Initializing = 0,
  Initialized = 1,
  Killed = 2,
  Migrating = 3,
}

export class FeeRecipient {
  recipient: PublicKey;
  portion: BN;

  constructor(recipient: PublicKey, portion: BN) {
    this.recipient = recipient;
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

export class RewardInfo {
  folioRewardToken: PublicKey;
  payoutLastPaid: BN;
  rewardIndex: BN;
  balanceAccounted: BN;
  balanceLastKnown: BN;
  totalClaimed: BN;

  constructor(
    folioRewardToken: PublicKey,
    payoutLastPaid: BN,
    rewardIndex: BN,
    balanceAccounted: BN,
    balanceLastKnown: BN,
    totalClaimed: BN
  ) {
    this.folioRewardToken = folioRewardToken;
    this.payoutLastPaid = payoutLastPaid;
    this.rewardIndex = rewardIndex;
    this.balanceAccounted = balanceAccounted;
    this.balanceLastKnown = balanceLastKnown;
    this.totalClaimed = totalClaimed;
  }

  public static async default(
    context: ProgramTestContext,
    folioRewardToken: PublicKey
  ) {
    return new RewardInfo(
      folioRewardToken,
      new BN((await context.banksClient.getClock()).unixTimestamp.toString()),
      new BN(0),
      new BN(0),
      new BN(0),
      new BN(0)
    );
  }
}

export class UserRewardInfo {
  folioRewardToken: PublicKey;
  user: PublicKey;
  lastRewardIndex: BN;
  accruedRewards: BN;

  constructor(
    folioRewardToken: PublicKey,
    user: PublicKey,
    lastRewardIndex: BN,
    accruedRewards: BN
  ) {
    this.folioRewardToken = folioRewardToken;
    this.user = user;
    this.lastRewardIndex = lastRewardIndex;
    this.accruedRewards = accruedRewards;
  }

  public static default(folioRewardToken: PublicKey, user: PublicKey) {
    return new UserRewardInfo(folioRewardToken, user, new BN(0), new BN(0));
  }
}

export class BasketRange {
  spot: BN;
  low: BN;
  high: BN;

  constructor(spot: BN, low: BN, high: BN) {
    this.spot = spot;
    this.low = low;
    this.high = high;
  }
}

export class AuctionEnd {
  mint: PublicKey;
  endTime: BN;

  constructor(mint: PublicKey, endTime: BN) {
    this.mint = mint;
    this.endTime = endTime;
  }
}

export class AuctionPrices {
  start: BN;
  end: BN;

  constructor(start: BN, end: BN) {
    this.start = start;
    this.end = end;
  }
}

export class Auction {
  id: BN;
  availableAt: BN;
  launchTimeout: BN;
  start: BN;
  end: BN;
  k: BN;
  folio: PublicKey;
  sell: PublicKey;
  buy: PublicKey;
  sellLimit: BasketRange;
  buyLimit: BasketRange;
  prices: AuctionPrices;

  constructor(
    id: BN,
    availableAt: BN,
    launchTimeout: BN,
    start: BN,
    end: BN,
    k: BN,
    folio: PublicKey,
    sell: PublicKey,
    buy: PublicKey,
    sellLimit: BasketRange,
    buyLimit: BasketRange,
    startPrice: BN,
    endPrice: BN
  ) {
    this.id = id;
    this.availableAt = availableAt;
    this.launchTimeout = launchTimeout;
    this.start = start;
    this.end = end;
    this.k = k;
    this.folio = folio;
    this.sell = sell;
    this.buy = buy;
    this.sellLimit = sellLimit;
    this.buyLimit = buyLimit;
    this.prices = new AuctionPrices(startPrice, endPrice);
  }

  public static default(
    folio: PublicKey,
    buyMint: PublicKey,
    sellMint: PublicKey
  ) {
    return new Auction(
      new BN(0),
      new BN(0),
      new BN(0),
      new BN(0),
      new BN(0),
      new BN(0),
      folio,
      sellMint,
      buyMint,

      new BasketRange(new BN(0), new BN(0), new BN(0)),
      new BasketRange(new BN(0), new BN(0), new BN(0)),
      new BN(0),
      new BN(0)
    );
  }
}

/*
General Helper functions for creating and setting accounts in the Bankrun environment.
*/
function getAccountDiscriminator(accountName: string): Buffer {
  const preimage = `account:${accountName}`;

  const hash = crypto.createHash("sha256").update(preimage).digest();

  return hash.slice(0, 8);
}

// Used to "reset" an account to a state where it looks like it isn't initialized
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
  program: Program<Folio> | Program<FolioSecond>,
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
    owner: program.programId,
    executable: false,
  };

  ctx.setAccount(accountAddress, accountInfo);
}

export async function createAndSetFolio(
  ctx: ProgramTestContext,
  program: Program<Folio> | Program<FolioSecond>,
  folioTokenMint: PublicKey,
  status: FolioStatus = FolioStatus.Initialized,
  customFolioMintFee: BN | null = null,
  lastPoke: BN = new BN(0),
  daoPendingFeeShares: BN = new BN(0),
  feeRecipientsPendingFeeShares: BN = new BN(0),
  useSecondFolioProgram: boolean = false,
  buyEnds: AuctionEnd[] = [],
  sellEnds: AuctionEnd[] = [],
  mandate: string = ""
) {
  // Set last poke as current time stamp, else 0 would make the elapsed time huge
  if (lastPoke.isZero()) {
    lastPoke = new BN(
      (await ctx.banksClient.getClock()).unixTimestamp.toString()
    );
  }

  const folioPDAWithBump = getFolioPDAWithBump(
    folioTokenMint,
    useSecondFolioProgram
  );

  const buffer = Buffer.alloc(1560);
  let offset = 0;

  // Encode discriminator
  const discriminator = getAccountDiscriminator("Folio");
  discriminator.copy(buffer, offset);
  offset += 8;

  // Write bump
  buffer.writeUInt8(folioPDAWithBump[1], offset);
  offset += 1;

  // Write status
  buffer.writeUInt8(status, offset);
  offset += 1;

  // Write padding
  buffer.fill(0, offset, offset + 14);
  offset += 14;

  folioTokenMint.toBuffer().copy(buffer, offset);
  offset += 32;

  // Set the value as if we went through set tvl fee on folio
  EXPECTED_TVL_FEE_WHEN_MAX.toArrayLike(Buffer, "le", 16).copy(buffer, offset);
  offset += 16;

  (customFolioMintFee ?? MAX_MINT_FEE)
    .toArrayLike(Buffer, "le", 16)
    .copy(buffer, offset);
  offset += 16;

  daoPendingFeeShares.toArrayLike(Buffer, "le", 16).copy(buffer, offset);
  offset += 16;

  feeRecipientsPendingFeeShares
    .toArrayLike(Buffer, "le", 16)
    .copy(buffer, offset);
  offset += 16;

  MAX_AUCTION_DELAY.toArrayLike(Buffer, "le", 8).copy(buffer, offset);
  offset += 8;

  MAX_AUCTION_LENGTH.toArrayLike(Buffer, "le", 8).copy(buffer, offset);
  offset += 8;

  new BN(0).toArrayLike(Buffer, "le", 8).copy(buffer, offset);
  offset += 8;

  lastPoke.toArrayLike(Buffer, "le", 8).copy(buffer, offset);
  offset += 8;

  // Write sell ends
  for (let i = 0; i < MAX_CONCURRENT_AUCTIONS; i++) {
    if (i < sellEnds.length) {
      sellEnds[i].mint.toBuffer().copy(buffer, offset);
      sellEnds[i].endTime
        .toArrayLike(Buffer, "le", 8)
        .copy(buffer, offset + 32);
    } else {
      PublicKey.default.toBuffer().copy(buffer, offset);
      new BN(0).toArrayLike(Buffer, "le", 8).copy(buffer, offset + 32);
    }
    offset += 40;
  }

  // Write buy ends
  for (let i = 0; i < MAX_CONCURRENT_AUCTIONS; i++) {
    if (i < buyEnds.length) {
      buyEnds[i].mint.toBuffer().copy(buffer, offset);
      buyEnds[i].endTime.toArrayLike(Buffer, "le", 8).copy(buffer, offset + 32);
    } else {
      PublicKey.default.toBuffer().copy(buffer, offset);
      new BN(0).toArrayLike(Buffer, "le", 8).copy(buffer, offset + 32);
    }
    offset += 40;
  }

  // Write mandate
  Buffer.from(mandate).copy(buffer, offset);
  offset += MAX_PADDED_STRING_LENGTH;

  await setFolioAccountInfo(
    ctx,
    program,
    folioPDAWithBump[0],
    "folio",
    null,
    buffer
  );
}

export async function createAndSetActor(
  ctx: ProgramTestContext,
  program: Program<Folio>,
  actorKeypair: Keypair | PublicKey,
  folio: PublicKey,
  roles: number
) {
  const actorKeypairToUse =
    actorKeypair instanceof Keypair ? actorKeypair.publicKey : actorKeypair;

  const actorPDAWithBump = getActorPDAWithBump(actorKeypairToUse, folio);

  const actor = {
    bump: actorPDAWithBump[1],
    authority: actorKeypairToUse,
    folio: folio,
    roles: roles,
  };

  await setFolioAccountInfo(ctx, program, actorPDAWithBump[0], "actor", actor);
}

export async function createAndSetFeeRecipients(
  ctx: ProgramTestContext,
  program: Program<Folio>,
  folio: PublicKey,
  feeRecipientsInitial: FeeRecipient[],
  distributionIndex: BN = new BN(0)
) {
  const feeRecipientsPDAWithBump = getTVLFeeRecipientsPDAWithBump(folio);

  const feeRecipients = {
    bump: feeRecipientsPDAWithBump[1],
    _padding: [0, 0, 0, 0, 0, 0, 0],
    distributionIndex: distributionIndex,
    folio: folio,
    feeRecipients: feeRecipientsInitial.map((fr) => ({
      recipient: fr.recipient,
      portion: fr.portion,
    })),
  };

  // Manual encoding for fee recipients
  const buffer = Buffer.alloc(3128);
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
  feeRecipients.feeRecipients.forEach((fr: any) => {
    fr.recipient.toBuffer().copy(buffer, offset);
    offset += 32;
    fr.portion.toArrayLike(Buffer, "le", 16).copy(buffer, offset);
    offset += 16;
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

export async function createAndSetFeeDistribution(
  ctx: ProgramTestContext,
  program: Program<Folio>,
  folio: PublicKey,
  cranker: PublicKey,
  distribtionIndex: BN,
  amountToDistribute: BN,
  feeRecipients: FeeRecipient[]
) {
  const feeDistributionPDAWithBump = getFeeDistributionPDAWithBump(
    folio,
    distribtionIndex
  );

  const feeDistribution = {
    bump: feeDistributionPDAWithBump[1],
    _padding: [0, 0, 0, 0, 0, 0, 0],
    distributionIndex: distribtionIndex,
    folio: folio,
    cranker: cranker,
    amountToDistribute: amountToDistribute,
    fee_recipients: feeRecipients.map((fr) => ({
      recipient: fr.recipient,
      portion: fr.portion,
    })),
  };

  // Manual encoding for fee recipients
  const buffer = Buffer.alloc(3176);
  let offset = 0;

  // Encode discriminator
  const discriminator = getAccountDiscriminator("FeeDistribution");
  discriminator.copy(buffer, offset);
  offset += 8;

  // Encode bump
  buffer.writeUInt8(feeDistribution.bump, offset);
  offset += 1;

  // Encode padding
  feeDistribution._padding.forEach((pad: number) => {
    buffer.writeUInt8(pad, offset);
    offset += 1;
  });

  // Encode distribution_index
  buffer.writeBigUInt64LE(
    BigInt(feeDistribution.distributionIndex.toNumber()),
    offset // Start writing at the current offset
  );
  offset += 8;

  // Encode folio pubkey
  feeDistribution.folio.toBuffer().copy(buffer, offset);
  offset += 32;

  // Encode cranker pubkey
  feeDistribution.cranker.toBuffer().copy(buffer, offset);
  offset += 32;

  // Encode amount to distribute
  feeDistribution.amountToDistribute
    .toArrayLike(Buffer, "le", 16)
    .copy(buffer, offset);
  offset += 16;

  // Encode fee recipients
  feeDistribution.fee_recipients.forEach((fr: any) => {
    fr.recipient.toBuffer().copy(buffer, offset);
    offset += 32;
    fr.portion.toArrayLike(Buffer, "le", 16).copy(buffer, offset);
    offset += 16;
  });

  await setFolioAccountInfo(
    ctx,
    program,
    feeDistributionPDAWithBump[0],
    "feeDistribution",
    feeDistribution,
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

export async function createAndSetFolioRewardTokens(
  ctx: ProgramTestContext,
  program: Program<Folio>,
  folio: PublicKey,
  rewardRatio: BN,
  rewardTokens: PublicKey[],
  disallowedToken: PublicKey[]
) {
  const folioRewardTokensPDAWithBump = getFolioRewardTokensPDAWithBump(folio);

  const folioRewardTokens = {
    bump: folioRewardTokensPDAWithBump[1],
    _padding: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    rewardRatio: rewardRatio,
    folio: folio,
    rewardTokens: rewardTokens,
    disallowedToken: disallowedToken,
  };

  // Manual encoding for fee recipients
  const buffer = Buffer.alloc(328);
  let offset = 0;

  // Encode discriminator
  const discriminator = getAccountDiscriminator("FolioRewardTokens");
  discriminator.copy(buffer, offset);
  offset += 8;

  // Encode bump
  buffer.writeUInt8(folioRewardTokens.bump, offset);
  offset += 1;

  // Encode padding
  folioRewardTokens._padding.forEach((pad: number) => {
    buffer.writeUInt8(pad, offset);
    offset += 1;
  });

  // Encode folio pubkey
  folioRewardTokens.folio.toBuffer().copy(buffer, offset);
  offset += 32;

  // Encode reward ratio (u256)
  rewardRatio.toArrayLike(Buffer, "le", 16).copy(buffer, offset);
  offset += 16;

  // Fill reward tokens array with provided tokens and pad with PublicKey.default
  const paddedRewardTokens = [
    ...folioRewardTokens.rewardTokens,
    ...Array(MAX_REWARD_TOKENS - folioRewardTokens.rewardTokens.length).fill(
      PublicKey.default
    ),
  ];

  paddedRewardTokens.forEach((token: PublicKey) => {
    token.toBuffer().copy(buffer, offset);
    offset += 32;
  });

  // Encode disallowed token
  folioRewardTokens.disallowedToken.forEach((dt: any) => {
    dt.toBuffer().copy(buffer, offset);
    offset += 32;
  });

  await setFolioAccountInfo(
    ctx,
    program,
    folioRewardTokensPDAWithBump[0],
    "folioRewardTokens",
    folioRewardTokens,
    buffer
  );
}

export async function createAndSetRewardInfo(
  ctx: ProgramTestContext,
  program: Program<Folio>,
  folio: PublicKey,
  providedRewardInfo: RewardInfo
) {
  const rewardInfoPDAWithBump = getRewardInfoPDAWithBump(
    folio,
    providedRewardInfo.folioRewardToken
  );

  const rewardInfo = {
    bump: rewardInfoPDAWithBump[1],
    folio: folio,
    folioRewardToken: providedRewardInfo.folioRewardToken,
    payoutLastPaid: providedRewardInfo.payoutLastPaid,
    rewardIndex: providedRewardInfo.rewardIndex,
    balanceAccounted: providedRewardInfo.balanceAccounted,
    balanceLastKnown: providedRewardInfo.balanceLastKnown,
    totalClaimed: providedRewardInfo.totalClaimed,
  };

  // Manual encoding for fee recipients
  const buffer = Buffer.alloc(145);
  let offset = 0;

  // Encode discriminator
  const discriminator = getAccountDiscriminator("RewardInfo");
  discriminator.copy(buffer, offset);
  offset += 8;

  // Encode bump
  buffer.writeUInt8(rewardInfo.bump, offset);
  offset += 1;

  // Encode folio pubkey
  rewardInfo.folio.toBuffer().copy(buffer, offset);
  offset += 32;

  // Encode folio reward token
  rewardInfo.folioRewardToken.toBuffer().copy(buffer, offset);
  offset += 32;

  // Encode payout last paid
  rewardInfo.payoutLastPaid.toArrayLike(Buffer, "le", 8).copy(buffer, offset);
  offset += 8;

  // Encode reward index
  rewardInfo.rewardIndex.toArrayLike(Buffer, "le", 16).copy(buffer, offset);
  offset += 16;

  // Encode balance accounted
  rewardInfo.balanceAccounted
    .toArrayLike(Buffer, "le", 16)
    .copy(buffer, offset);
  offset += 16;

  // Encode balance last known
  rewardInfo.balanceLastKnown
    .toArrayLike(Buffer, "le", 16)
    .copy(buffer, offset);
  offset += 16;

  // Encode total claimed
  rewardInfo.totalClaimed.toArrayLike(Buffer, "le", 16).copy(buffer, offset);
  offset += 16;

  await setFolioAccountInfo(
    ctx,
    program,
    rewardInfoPDAWithBump[0],
    "rewardInfo",
    rewardInfo,
    buffer
  );
}

export async function createAndSetUserRewardInfo(
  ctx: ProgramTestContext,
  program: Program<Folio>,
  folio: PublicKey,
  userRewardInfoProvided: UserRewardInfo
) {
  const userRewardInfoPDAWithBump = getUserRewardInfoPDAWithBump(
    folio,
    userRewardInfoProvided.folioRewardToken,
    userRewardInfoProvided.user
  );

  const userRewardInfo = {
    bump: userRewardInfoPDAWithBump[1],
    folio: folio,
    folioRewardToken: userRewardInfoProvided.folioRewardToken,
    lastRewardIndex: userRewardInfoProvided.lastRewardIndex,
    accruedRewards: userRewardInfoProvided.accruedRewards,
  };

  // Manual encoding for fee recipients
  const buffer = Buffer.alloc(105);
  let offset = 0;

  // Encode discriminator
  const discriminator = getAccountDiscriminator("UserRewardInfo");
  discriminator.copy(buffer, offset);
  offset += 8;

  // Encode bump
  buffer.writeUInt8(userRewardInfo.bump, offset);
  offset += 1;

  // Encode folio pubkey
  userRewardInfo.folio.toBuffer().copy(buffer, offset);
  offset += 32;

  // Encode folio reward token
  userRewardInfo.folioRewardToken.toBuffer().copy(buffer, offset);
  offset += 32;

  // Encode last reward index
  userRewardInfo.lastRewardIndex
    .toArrayLike(Buffer, "le", 16)
    .copy(buffer, offset);
  offset += 16;

  // Encode accrued rewards
  userRewardInfo.accruedRewards
    .toArrayLike(Buffer, "le", 16)
    .copy(buffer, offset);
  offset += 16;

  await setFolioAccountInfo(
    ctx,
    program,
    userRewardInfoPDAWithBump[0],
    "userRewardInfo",
    userRewardInfo,
    buffer
  );
}

export async function createAndSetAuction(
  ctx: ProgramTestContext,
  program: Program<Folio>,
  auction: Auction,
  folio: PublicKey
) {
  const auctionPDAWithBump = getAuctionPDAWithBump(folio, auction.id);

  // Manual encoding for fee recipients
  const buffer = Buffer.alloc(296);
  let offset = 0;

  // Encode discriminator
  const discriminator = getAccountDiscriminator("Auction");
  discriminator.copy(buffer, offset);
  offset += 8;

  // Encode bump
  buffer.writeUInt8(auctionPDAWithBump[1], offset);
  offset += 1;

  // Encode padding
  [0, 0, 0, 0, 0, 0, 0].forEach((pad: number) => {
    buffer.writeUInt8(pad, offset);
    offset += 1;
  });

  // Encode id
  auction.id.toArrayLike(Buffer, "le", 8).copy(buffer, offset);
  offset += 8;

  // Encode available at
  auction.availableAt.toArrayLike(Buffer, "le", 8).copy(buffer, offset);
  offset += 8;

  // Encode launch timeout
  auction.launchTimeout.toArrayLike(Buffer, "le", 8).copy(buffer, offset);
  offset += 8;

  // Encode start
  auction.start.toArrayLike(Buffer, "le", 8).copy(buffer, offset);
  offset += 8;

  // Encode end
  auction.end.toArrayLike(Buffer, "le", 8).copy(buffer, offset);
  offset += 8;

  // Encode k (u128)
  auction.k.toArrayLike(Buffer, "le", 16).copy(buffer, offset);
  offset += 16;

  // Encode folio pubkey
  folio.toBuffer().copy(buffer, offset);
  offset += 32;

  // Encode sell
  auction.sell.toBuffer().copy(buffer, offset);
  offset += 32;

  // Encode buy
  auction.buy.toBuffer().copy(buffer, offset);
  offset += 32;

  // Encode sell limit
  auction.sellLimit.spot.toArrayLike(Buffer, "le", 16).copy(buffer, offset);
  offset += 16;

  auction.sellLimit.low.toArrayLike(Buffer, "le", 16).copy(buffer, offset);
  offset += 16;

  auction.sellLimit.high.toArrayLike(Buffer, "le", 16).copy(buffer, offset);
  offset += 16;

  // Encode buy limit
  auction.buyLimit.spot.toArrayLike(Buffer, "le", 16).copy(buffer, offset);
  offset += 16;

  auction.buyLimit.low.toArrayLike(Buffer, "le", 16).copy(buffer, offset);
  offset += 16;

  auction.buyLimit.high.toArrayLike(Buffer, "le", 16).copy(buffer, offset);
  offset += 16;

  // Encode start price
  auction.prices.start.toArrayLike(Buffer, "le", 16).copy(buffer, offset);
  offset += 16;

  // Encode end price
  auction.prices.end.toArrayLike(Buffer, "le", 16).copy(buffer, offset);
  offset += 16;

  await setFolioAccountInfo(
    ctx,
    program,
    auctionPDAWithBump[0],
    "auction",
    auction,
    buffer
  );
}

/*
Folio Admin Accounts
*/
export async function setFolioAdminAccountInfo(
  ctx: ProgramTestContext,
  program: Program<FolioAdmin>,
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
    owner: FOLIO_ADMIN_PROGRAM_ID,
    executable: false,
  });
}

export async function createAndSetDaoFeeConfig(
  ctx: ProgramTestContext,
  program: Program<FolioAdmin>,
  feeRecipient: PublicKey,
  feeNumerator: BN,
  feeFloor: BN = MAX_FEE_FLOOR
) {
  const daoFeeConfigPDAWithBump = getDaoFeeConfigPDAWithBump();
  const daoFeeConfig = {
    bump: daoFeeConfigPDAWithBump[1],
    feeRecipient,
    feeNumerator,
    feeFloor,
  };

  const buffer = Buffer.alloc(73);
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

  // Encode fee floor
  const floorValue = BigInt(daoFeeConfig.feeFloor.toString());
  buffer.writeBigUInt64LE(
    BigInt(floorValue & BigInt("0xFFFFFFFFFFFFFFFF")),
    offset
  );
  offset += 8;
  buffer.writeBigUInt64LE(BigInt(floorValue >> BigInt(64)), offset);
  offset += 8;

  await setFolioAdminAccountInfo(
    ctx,
    program,
    daoFeeConfigPDAWithBump[0],
    "daoFeeConfig",
    daoFeeConfig,
    buffer
  );
}

export async function createAndSetFolioFeeConfig(
  ctx: ProgramTestContext,
  program: Program<FolioAdmin>,
  folio: PublicKey,
  feeNumerator: BN,
  feeFloor: BN = MAX_FEE_FLOOR
) {
  const folioFeeConfigPDAWithBump = getFolioFeeConfigPDAWithBump(folio);
  const folioFeeConfig = {
    bump: folioFeeConfigPDAWithBump[1],
    feeNumerator,
    feeFloor,
  };

  const buffer = Buffer.alloc(41);
  let offset = 0;

  // Encode discriminator
  const discriminator = getAccountDiscriminator("FolioFeeConfig");
  discriminator.copy(buffer, offset);
  offset += 8;

  // Encode bump
  buffer.writeUInt8(folioFeeConfig.bump, offset);
  offset += 1;

  // Encode fee numerator
  const value = BigInt(folioFeeConfig.feeNumerator.toString());
  buffer.writeBigUInt64LE(BigInt(value & BigInt("0xFFFFFFFFFFFFFFFF")), offset);
  offset += 8;
  buffer.writeBigUInt64LE(BigInt(value >> BigInt(64)), offset);
  offset += 8;

  // Encode fee floor
  const floorValue = BigInt(folioFeeConfig.feeFloor.toString());
  buffer.writeBigUInt64LE(
    BigInt(floorValue & BigInt("0xFFFFFFFFFFFFFFFF")),
    offset
  );
  offset += 8;
  buffer.writeBigUInt64LE(BigInt(floorValue >> BigInt(64)), offset);
  offset += 8;

  await setFolioAdminAccountInfo(
    ctx,
    program,
    folioFeeConfigPDAWithBump[0],
    "folioFeeConfig",
    folioFeeConfig,
    buffer
  );
}

export async function createAndSetProgramRegistrar(
  ctx: ProgramTestContext,
  program: Program<FolioAdmin>,
  acceptedPrograms: PublicKey[]
) {
  const programRegistrarPDAWithBump = getProgramRegistrarPDAWithBump();

  const programRegistrar = {
    bump: programRegistrarPDAWithBump[1],
    acceptedPrograms: acceptedPrograms.concat(
      Array(10 - acceptedPrograms.length).fill(PublicKey.default)
    ),
  };

  await setFolioAdminAccountInfo(
    ctx,
    program,
    programRegistrarPDAWithBump[0],
    "programRegistrar",
    programRegistrar
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

export async function buildRemainingAccountsForUpdateFolio(
  context: ProgramTestContext,
  folio: PublicKey,
  folioTokenMint: PublicKey,
  daoFeeRecipient: PublicKey
): Promise<AccountMeta[]> {
  const remainingAccounts: AccountMeta[] = [
    {
      pubkey: TOKEN_PROGRAM_ID,
      isSigner: false,
      isWritable: false,
    },
    {
      pubkey: getDAOFeeConfigPDA(),
      isSigner: false,
      isWritable: false,
    },
    {
      pubkey: getFolioFeeConfigPDA(folio),
      isSigner: false,
      isWritable: false,
    },
    {
      pubkey: folioTokenMint,
      isSigner: false,
      isWritable: true,
    },
    {
      pubkey: getFeeDistributionPDA(folio, new BN(1)),
      isSigner: false,
      isWritable: true,
    },
    {
      pubkey: await getOrCreateAtaAddress(
        context,
        folioTokenMint,
        daoFeeRecipient
      ),
      isSigner: false,
      isWritable: true,
    },
  ];

  return remainingAccounts;
}

export async function buildRemainingAccounts(
  context: ProgramTestContext,
  tokens: { mint: PublicKey; amount: BN }[],
  senderAddress: PublicKey = null,
  recipientAddress: PublicKey = null,
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
    if (recipientAddress) {
      remainingAccounts.push({
        pubkey: await getOrCreateAtaAddress(
          context,
          token.mint,
          recipientAddress
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

    if (extraUser.toString() !== callerKeypair.publicKey.toString()) {
      remainingAccounts.push({
        pubkey: getUserRewardInfoPDA(folio, token, extraUser),
        isSigner: false,
        isWritable: true,
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
      pubkey: getRewardInfoPDA(folio, token),
      isSigner: false,
      isWritable: true,
    });

    remainingAccounts.push({
      pubkey: await getOrCreateAtaAddress(context, token, folioRewardTokensPDA),
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

export async function buildRemainingAccountsForMigrateFolioTokens(
  context: ProgramTestContext,
  userKeypair: Keypair,
  oldFolio: PublicKey,
  newFolio: PublicKey,
  tokens: PublicKey[]
) {
  const remainingAccounts: AccountMeta[] = [];

  for (const token of tokens) {
    remainingAccounts.push({
      pubkey: token,
      isSigner: false,
      isWritable: false,
    });

    remainingAccounts.push({
      pubkey: await getOrCreateAtaAddress(context, token, oldFolio),
      isSigner: false,
      isWritable: true,
    });

    remainingAccounts.push({
      pubkey: await getOrCreateAtaAddress(context, token, newFolio),
      isSigner: false,
      isWritable: true,
    });
  }

  return remainingAccounts;
}
