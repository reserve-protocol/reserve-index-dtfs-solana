import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as borsh from "borsh";
import { Amman, PersistedAccountInfo } from "@metaplex-foundation/amman-client";
import { SPL_GOVERNANCE_PROGRAM_ID } from "./pda-helper";

class RealmConfig {
  use_council_mint: boolean;
  min_community_tokens_to_create_governance: number;
  use_community_voter_weight_addin: boolean;
  use_max_community_voter_weight_addin: boolean;

  constructor(fields: {
    use_council_mint: boolean;
    min_community_tokens_to_create_governance: number;
    use_community_voter_weight_addin: boolean;
    use_max_community_voter_weight_addin: boolean;
  }) {
    this.use_council_mint = fields.use_council_mint;
    this.min_community_tokens_to_create_governance =
      fields.min_community_tokens_to_create_governance;
    this.use_community_voter_weight_addin =
      fields.use_community_voter_weight_addin;
    this.use_max_community_voter_weight_addin =
      fields.use_max_community_voter_weight_addin;
  }
}

class RealmV2 {
  account_type: number;
  community_mint: Uint8Array;
  config: RealmConfig;
  reserved: number[];
  legacy1: number;
  authority: Uint8Array | null;
  name: string;
  reserved_v2: number[];

  constructor(fields: {
    account_type: number;
    community_mint: Uint8Array;
    config: RealmConfig;
    reserved: number[];
    legacy1: number;
    authority: Uint8Array | null;
    name: string;
    reserved_v2: number[];
  }) {
    this.account_type = fields.account_type;
    this.community_mint = fields.community_mint;
    this.config = fields.config;
    this.reserved = fields.reserved;
    this.legacy1 = fields.legacy1;
    this.authority = fields.authority;
    this.name = fields.name;
    this.reserved_v2 = fields.reserved_v2;
  }
}

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

const RealmConfigSchema = new Map([
  [
    RealmConfig,
    {
      kind: "struct",
      fields: [
        ["use_council_mint", "u8"],
        ["min_community_tokens_to_create_governance", "u64"],
        ["use_community_voter_weight_addin", "u8"],
        ["use_max_community_voter_weight_addin", "u8"],
      ],
    },
  ],
]);

const RealmV2Schema = new Map([
  [
    RealmV2,
    {
      kind: "struct",
      fields: [
        ["account_type", "u8"],
        ["community_mint", [32]],
        ["config", RealmConfig],
        ["reserved", [6]],
        ["legacy1", "u16"],
        ["authority", { kind: "option", type: [32] }],
        ["name", "string"],
        ["reserved_v2", [128]],
      ],
    },
  ],
]);

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
RealmConfigSchema.forEach((value, key) => {
  combinedSchema.set(key, value);
});
RealmV2Schema.forEach((value, key) => {
  combinedSchema.set(key, value);
});
TokenOwnerRecordV2Schema.forEach((value, key) => {
  combinedSchema.set(key, value);
});

// function createFakeRealmV2(): Buffer {
//   const realmConfig = new RealmConfig({
//     use_council_mint: true,
//     min_community_tokens_to_create_governance: 100,
//     use_community_voter_weight_addin: false,
//     use_max_community_voter_weight_addin: false,
//   });

//   const realmV2 = new RealmV2({
//     account_type: 1,
//     community_mint: Keypair.generate().publicKey.toBytes(),
//     config: realmConfig,
//     reserved: new Array(6).fill(0),
//     legacy1: 0,
//     authority: Keypair.generate().publicKey.toBytes(),
//     name: "Test Realm",
//     reserved_v2: new Array(128).fill(0),
//   });

//   return Buffer.from(borsh.serialize(combinedSchema, realmV2));
// }

function createFakeTokenOwnerRecordV2(
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
  connection: Connection,
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
