import { Keypair, PublicKey } from "@solana/web3.js";
import * as borsh from "borsh";
import { Amman, PersistedAccountInfo } from "@metaplex-foundation/amman-client";
import { SPL_GOVERNANCE_PROGRAM_ID } from "./pda-helper";

class TokenOwnerRecordV2 {
  accountType: number;
  realm: Uint8Array;
  governingTokenMint: Uint8Array;
  governingTokenOwner: Uint8Array;
  governingTokenDepositAmount: bigint;
  unrelinquishedVotesCount: bigint;
  outstandingProposalCount: number;
  version: number;
  reserved: Uint8Array;
  governanceDelegate: Uint8Array | null;
  reservedV2: Uint8Array;

  constructor(fields: {
    accountType: number;
    realm: Uint8Array;
    governingTokenMint: Uint8Array;
    governingTokenOwner: Uint8Array;
    governingTokenDepositAmount: bigint;
    unrelinquishedVotesCount: bigint;
    outstandingProposalCount: number;
    version: number;
    reserved: Uint8Array;
    governanceDelegate: Uint8Array | null;
    reservedV2: Uint8Array;
  }) {
    this.accountType = fields.accountType;
    this.realm = fields.realm;
    this.governingTokenMint = fields.governingTokenMint;
    this.governingTokenOwner = fields.governingTokenOwner;
    this.governingTokenDepositAmount = fields.governingTokenDepositAmount;
    this.unrelinquishedVotesCount = fields.unrelinquishedVotesCount;
    this.outstandingProposalCount = fields.outstandingProposalCount;
    this.version = fields.version;
    this.reserved = fields.reserved;
    this.governanceDelegate = fields.governanceDelegate;
    this.reservedV2 = fields.reservedV2;
  }
}

const TokenOwnerRecordV2Schema = new Map([
  [
    TokenOwnerRecordV2,
    {
      kind: "struct",
      fields: [
        ["accountType", "u8"],
        ["realm", [32]],
        ["governingTokenMint", [32]],
        ["governingTokenOwner", [32]],
        ["governingTokenDepositAmount", "u64"],
        ["unrelinquishedVotesCount", "u64"],
        ["outstandingProposalCount", "u8"],
        ["version", "u8"],
        ["reserved", [6]],
        ["governanceDelegate", { kind: "option", type: [32] }],
        ["reservedV2", [128]],
      ],
    },
  ],
]);

const combinedSchema = new Map<any, any>();
TokenOwnerRecordV2Schema.forEach((value, key) => {
  combinedSchema.set(key, value);
});

export function createFakeTokenOwnerRecordV2(
  governingTokenDepositAmount: number,
  realm: PublicKey,
  governingTokenMint: PublicKey,
  governingTokenOwner: PublicKey,
  governanceDelegate: PublicKey
): Buffer {
  const tokenOwnerRecordV2 = new TokenOwnerRecordV2({
    accountType: 2,
    realm: realm.toBytes(),
    governingTokenMint: governingTokenMint.toBytes(),
    governingTokenOwner: governingTokenOwner.toBytes(),
    governingTokenDepositAmount: BigInt(governingTokenDepositAmount),
    unrelinquishedVotesCount: BigInt(0),
    outstandingProposalCount: 0,
    version: 1,
    reserved: new Uint8Array(6),
    governanceDelegate: governanceDelegate.toBytes(),
    reservedV2: new Uint8Array(128),
  });

  return Buffer.from(borsh.serialize(combinedSchema, tokenOwnerRecordV2));
}
export async function createGovernanceAccounts(
  userTokenRecordPda: PublicKey,
  depositAmount: number
) {
  const amman = Amman.instance({
    ammanClientOpts: { autoUnref: false, ack: true },
    connectClient: true,
  });

  const fakeTokenOwnerRecordV2 = createFakeTokenOwnerRecordV2(
    depositAmount,
    Keypair.generate().publicKey,
    Keypair.generate().publicKey,
    Keypair.generate().publicKey,
    Keypair.generate().publicKey
  );

  const persistedAccountInfoRealm: PersistedAccountInfo = {
    pubkey: userTokenRecordPda.toString(),
    account: {
      lamports: 1000000000,
      data: [fakeTokenOwnerRecordV2.toString("base64"), "base64"],
      owner: SPL_GOVERNANCE_PROGRAM_ID.toString(),
      executable: false,
      rentEpoch: 0,
    },
  };

  await amman.ammanClient.requestSetAccount(persistedAccountInfoRealm);
}
