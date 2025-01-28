import { Keypair } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import { ProgramTestContext } from "solana-bankrun";
import {
  getActorPDAWithBump,
  getDaoFeeConfigPDAWithBump,
  getDtfSignerPDAWithBump,
  getFolioFeeRecipientsPDAWithBump,
  getFolioPDAWithBump,
  getProgramDataPDA,
  getProgramRegistrarPDAWithBump,
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
} from "../../utils/constants";

export enum Role {
  Owner = 0b00000001, // 1
  TradeProposer = 0b00000010, // 2
  TradeLauncher = 0b00000100, // 4
  VibeOfficer = 0b00001000, // 8
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
  status: FolioStatus = FolioStatus.Initialized
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
    mintingFee: MIN_DAO_MINTING_FEE,
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

  // Encode header
  buffer.writeUInt8(feeRecipients.bump, offset);
  offset += 1;

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

/*
DTF Accounts
*/
export async function setDTFAccountInfo(
  ctx: ProgramTestContext,
  program: Program<Dtfs>,
  accountAddress: PublicKey,
  accountName: string,
  accountData: any
) {
  const encodedAccountData = await program.coder.accounts.encode(
    accountName,
    accountData
  );

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

  await setDTFAccountInfo(
    ctx,
    program,
    daoFeeConfigPDAWithBump[0],
    "daoFeeConfig",
    daoFeeConfig
  );
}
