import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import {
  DEFAULT_DECIMALS,
  SPL_GOVERNANCE_PROGRAM_ID,
} from "../../utils/constants";
import { BN } from "@coral-xyz/anchor";
import { createFakeTokenOwnerRecordV2 } from "../../utils/data-helper";
import {
  ACCOUNT_SIZE,
  AccountLayout,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  BanksTransactionResultWithMeta,
  createAndProcessTransaction,
} from "./bankrun-program-helper";
import { initToken } from "./bankrun-token-helper";
import {
  getGovernanceAccountPDA,
  getProposalPDA,
  getProposalTransactionPDA,
  getRealmPDA,
} from "../../utils/pda-helper";
import { getComputeLimitInstruction } from "../../utils/program-helper";
import { LiteSVM } from "litesvm";

/**
 * Helper functions for creating governance accounts and proposals (data serialization)
 * within the Bankrun environment.
 */
function serializeProposalData(
  proposalData: any,
  instructions: TransactionInstruction[]
): Buffer {
  const buffer = Buffer.alloc(1024);
  let offset = 0;

  // Write account type (ProposalV2 = 14)
  buffer.writeUInt8(14, offset);
  offset += 1;

  // Write governance
  proposalData.governance.toBuffer().copy(buffer, offset);
  offset += 32;

  // Write governing token mint
  proposalData.governingTokenMint.toBuffer().copy(buffer, offset);
  offset += 32;

  // Write state
  buffer.writeUInt8(proposalData.state, offset);
  offset += 1;

  // Write token owner record
  proposalData.tokenOwnerRecord.toBuffer().copy(buffer, offset);
  offset += 32;

  // Write signatories counts
  buffer.writeUInt8(proposalData.signatoriesCount, offset);
  offset += 1;
  buffer.writeUInt8(proposalData.signatoriesSignedOffCount, offset);
  offset += 1;

  // Write vote type (SingleChoice = 0)
  buffer.writeUInt8(proposalData.voteType, offset);
  offset += 1;

  // Write options array
  const options = [
    {
      label: "Yes",
      vote_weight: proposalData.yesVotesCount.toNumber(),
      vote_result: 1, // Succeeded
      transactions_executed_count: 0,
      transactions_count: instructions.length,
      transactions_next_index: 0,
    },
  ];

  buffer.writeUInt32LE(options.length, offset); // Vec length
  offset += 4;

  for (const option of options) {
    // Write label as string
    const labelBytes = Buffer.from(option.label);
    buffer.writeUInt32LE(labelBytes.length, offset);
    offset += 4;
    labelBytes.copy(buffer, offset);
    offset += labelBytes.length;

    // Write vote_weight
    buffer.writeBigUInt64LE(BigInt(option.vote_weight), offset);
    offset += 8;

    // Write vote_result
    buffer.writeUInt8(option.vote_result, offset);
    offset += 1;

    // Write transactions counts
    buffer.writeUInt16LE(option.transactions_executed_count, offset);
    offset += 2;
    buffer.writeUInt16LE(option.transactions_count, offset);
    offset += 2;
    buffer.writeUInt16LE(option.transactions_next_index, offset);
    offset += 2;
  }

  // Write deny_vote_weight Option<u64>
  buffer.writeUInt8(1, offset); // Some
  offset += 1;
  buffer.writeBigUInt64LE(BigInt(proposalData.noVotesCount), offset);
  offset += 8;

  // Write reserved1
  buffer.writeUInt8(0, offset);
  offset += 1;

  // Write abstain_vote_weight Option<u64>
  buffer.writeUInt8(0, offset); // None
  offset += 1;

  // Write start_voting_at Option<i64>
  buffer.writeUInt8(0, offset); // None
  offset += 1;

  // Write draft_at i64
  buffer.writeBigInt64LE(BigInt(proposalData.draftAt), offset);
  offset += 8;

  // Write signing_off_at Option<i64>
  if (proposalData.signingOffAt) {
    buffer.writeUInt8(1, offset);
    offset += 1;
    buffer.writeBigInt64LE(BigInt(proposalData.signingOffAt), offset);
    offset += 8;
  } else {
    buffer.writeUInt8(0, offset);
    offset += 1;
  }

  // Write voting_at Option<i64>
  if (proposalData.votingAt) {
    buffer.writeUInt8(1, offset);
    offset += 1;
    buffer.writeBigInt64LE(BigInt(proposalData.votingAt), offset);
    offset += 8;
  } else {
    buffer.writeUInt8(0, offset);
    offset += 1;
  }

  // Write voting_at_slot Option<u64>
  if (proposalData.votingAtSlot) {
    buffer.writeUInt8(1, offset);
    offset += 1;
    buffer.writeBigUInt64LE(BigInt(proposalData.votingAtSlot), offset);
    offset += 8;
  } else {
    buffer.writeUInt8(0, offset);
    offset += 1;
  }

  // Write voting_completed_at Option<i64>
  if (proposalData.votingCompletedAt) {
    buffer.writeUInt8(1, offset);
    offset += 1;
    buffer.writeBigInt64LE(BigInt(proposalData.votingCompletedAt), offset);
    offset += 8;
  } else {
    buffer.writeUInt8(0, offset);
    offset += 1;
  }

  // Write executing_at Option<i64>
  buffer.writeUInt8(0, offset); // None
  offset += 1;

  // Write closed_at Option<i64>
  buffer.writeUInt8(0, offset); // None
  offset += 1;

  // Write execution_flags
  buffer.writeUInt8(proposalData.executionFlags, offset);
  offset += 1;

  // Write max_vote_weight Option<u64>
  if (proposalData.maxVoteWeight) {
    buffer.writeUInt8(1, offset);
    offset += 1;
    buffer.writeBigUInt64LE(BigInt(proposalData.maxVoteWeight), offset);
    offset += 8;
  } else {
    buffer.writeUInt8(0, offset);
    offset += 1;
  }

  // Write max_voting_time Option<u32>
  buffer.writeUInt8(0, offset); // None
  offset += 1;

  // Write vote_threshold Option<VoteThreshold>
  if (proposalData.voteThreshold) {
    buffer.writeUInt8(1, offset); // Some
    offset += 1;
    buffer.writeUInt8(1, offset); // YesVotePercentage type
    offset += 1;
    buffer.writeUInt8(proposalData.voteThreshold, offset);
    offset += 1;
  } else {
    buffer.writeUInt8(0, offset); // None
    offset += 1;
  }

  // Write reserved
  buffer.fill(0, offset, offset + 64);
  offset += 64;

  // Write name
  const nameBuffer = Buffer.from(proposalData.name);
  buffer.writeUInt32LE(nameBuffer.length, offset);
  offset += 4;
  nameBuffer.copy(buffer, offset);
  offset += nameBuffer.length;

  // Write description_link
  const descBuffer = Buffer.from(proposalData.descriptionLink);
  buffer.writeUInt32LE(descBuffer.length, offset);
  offset += 4;
  descBuffer.copy(buffer, offset);
  offset += descBuffer.length;

  // Write veto_vote_weight
  buffer.writeBigUInt64LE(BigInt(0), offset);
  offset += 8;

  return buffer;
}

// Serialize transaction data, for when a DAO want to execute arbitrary instructions
// via a proposal.
function serializeTransactionData(
  transactionData: any,
  instructions: TransactionInstruction[]
): Buffer {
  const buffer = Buffer.alloc(1024); // We can calculate exact size if needed
  let offset = 0;

  // Write account type (ProposalTransactionV2 = 13)
  buffer.writeUInt8(13, offset);
  offset += 1;

  // Write proposal
  transactionData.proposal.toBuffer().copy(buffer, offset);
  offset += 32;

  // Write option_index
  buffer.writeUInt8(transactionData.optionIndex, offset);
  offset += 1;

  // Write transaction_index
  buffer.writeUInt16LE(transactionData.transactionIndex, offset);
  offset += 2;

  // Write legacy
  buffer.writeUInt32LE(transactionData.holdUpTime, offset);
  offset += 4;

  // Write instructions Vec
  buffer.writeUInt32LE(instructions.length, offset); // Vec length
  offset += 4;

  for (const ix of instructions) {
    // Write programId
    ix.programId.toBuffer().copy(buffer, offset);
    offset += 32;

    // Write accounts array length
    buffer.writeUInt32LE(ix.keys.length, offset);
    offset += 4;

    // Write accounts
    for (const key of ix.keys) {
      key.pubkey.toBuffer().copy(buffer, offset);
      offset += 32;
      buffer.writeUInt8(key.isSigner ? 1 : 0, offset);
      offset += 1;
      buffer.writeUInt8(key.isWritable ? 1 : 0, offset);
      offset += 1;
    }

    // Write data length and data
    buffer.writeUInt32LE(ix.data.length, offset);
    offset += 4;
    ix.data.copy(buffer, offset);
    offset += ix.data.length;
  }

  // Write executed_at Option<i64>
  buffer.writeUInt8(0, offset); // None
  offset += 1;

  // Write execution_status
  buffer.writeUInt8(transactionData.executionStatus, offset);
  offset += 1;

  // Write reserved_v2
  buffer.fill(0, offset, offset + 8);
  offset += 8;

  return buffer;
}

/*
Helpers for creating mocked account related to the SPL governance program.
*/
export function createProposalWithInstructions(
  context: LiteSVM,
  governanceAccount: PublicKey,
  proposalOwner: PublicKey,
  governingTokenMint: PublicKey,
  instructions: TransactionInstruction[]
) {
  // Create proposal account
  const proposalSeed = Keypair.generate().publicKey;
  const proposalPda = getProposalPDA(
    governanceAccount,
    governingTokenMint,
    proposalSeed
  );

  // Create proposal data
  const now = Math.floor(Date.now() / 1000);

  // Some of the times are set to properly mimick time passing
  const proposalData = {
    accountType: 14, // ProposalV2
    governance: governanceAccount,
    governingTokenMint: governingTokenMint,
    state: 4, // Succeeded
    tokenOwnerRecord: proposalOwner,
    signatoriesCount: 1,
    signatoriesSignedOffCount: 1,
    voteType: 0, // SingleChoice
    yesVotesCount: new BN(100),
    noVotesCount: new BN(0),
    instructionsExecutedCount: 0,
    instructionsCount: 1,
    instructionsNextIndex: 0,
    draftAt: new BN(now - 100),
    signingOffAt: new BN(now - 80),
    votingAt: new BN(now - 60),
    votingAtSlot: new BN(0),
    votingCompletedAt: new BN(now - 40),
    executingAt: null,
    closedAt: null,
    executionFlags: 0,
    maxVoteWeight: new BN(100),
    voteThreshold: 60,
    name: "Mocked Proposal",
    descriptionLink: "https://mock.proposal",
  };

  // Create proposal transaction account
  const proposalTransactionPda = getProposalTransactionPDA(proposalPda, 0, 0);

  // Create transaction data
  const transactionData = {
    accountType: 13, // ProposalTransactionV2
    proposal: proposalPda,
    optionIndex: 0,
    transactionIndex: 0,
    holdUpTime: 0,
    instructions: instructions,
    executedAt: null,
    executionStatus: 0, // None
  };

  // Write proposal account
  const proposalBuffer = serializeProposalData(proposalData, instructions);

  // Write transaction account
  const transactionBuffer = serializeTransactionData(
    transactionData,
    instructions
  );

  // Set accounts
  context.setAccount(proposalPda, {
    lamports: 1_000_000_000,
    data: proposalBuffer,
    owner: SPL_GOVERNANCE_PROGRAM_ID,
    executable: false,
  });

  context.setAccount(proposalTransactionPda, {
    lamports: 1_000_000_000,
    data: transactionBuffer,
    owner: SPL_GOVERNANCE_PROGRAM_ID,
    executable: false,
  });

  return {
    proposalAddress: proposalPda,
    proposalTransactionAddress: proposalTransactionPda,
  };
}

// Use to create Governance accounts that would represent Folio Owners, Auction Launchers, etc.
// Are an authority controlled by the Realm (can have multiple governance account under the Realm)
export function createGovernanceAccount(
  context: LiteSVM,
  realm: PublicKey,
  governanceAccount: PublicKey,
  governanceSeed: PublicKey
) {
  // Default config values
  const governanceConfig = {
    communityVoteThreshold: 60,
    minCommunityWeightToCreateProposal: 5,
    transactionsHoldUpTime: 10,
    votingBaseTime: 5,
    communityVoteTipping: 0,
    councilVoteThreshold: 60,
    councilVetoVoteThreshold: 50,
    minCouncilWeightToCreateProposal: 1,
    councilVoteTipping: 0, // Strict
    communityVetoVoteThreshold: 40,
    votingCoolOffTime: 2,
    depositExemptProposalCount: 10,
  };

  const governanceData = {
    accountType: 18, // GovernanceV2
    realm: realm,
    governanceSeed: governanceSeed,
    reserved1: 0,
    config: governanceConfig,
    reservedV2: new Array(119).fill(0),
    requiredSignatoriesCount: 0,
    activeProposalCount: 0,
  };

  const governanceBuffer = Buffer.alloc(236);
  let offset = 0;

  // Write account type
  governanceBuffer.writeUInt8(governanceData.accountType, offset);
  offset += 1;

  // Write realm
  governanceData.realm.toBuffer().copy(governanceBuffer, offset);
  offset += 32;

  // Write governance seed
  governanceData.governanceSeed.toBuffer().copy(governanceBuffer, offset);
  offset += 32;

  // Write reserved1
  governanceBuffer.writeUInt32LE(governanceData.reserved1, offset);
  offset += 4;

  // Write config
  governanceBuffer.writeUInt8(1, offset); // YesVotePercentage type
  offset += 1;
  governanceBuffer.writeUInt8(governanceConfig.communityVoteThreshold, offset);
  offset += 1;

  governanceBuffer.writeBigUInt64LE(
    BigInt(governanceConfig.minCommunityWeightToCreateProposal),
    offset
  );
  offset += 8;

  governanceBuffer.writeUInt32LE(
    governanceConfig.transactionsHoldUpTime,
    offset
  );
  offset += 4;

  governanceBuffer.writeUInt32LE(governanceConfig.votingBaseTime, offset);
  offset += 4;

  governanceBuffer.writeUInt8(governanceConfig.communityVoteTipping, offset);
  offset += 1;

  governanceBuffer.writeUInt8(1, offset); // YesVotePercentage type
  offset += 1;
  governanceBuffer.writeUInt8(governanceConfig.councilVoteThreshold, offset);
  offset += 1;

  governanceBuffer.writeUInt8(1, offset); // YesVotePercentage type
  offset += 1;
  governanceBuffer.writeUInt8(
    governanceConfig.councilVetoVoteThreshold,
    offset
  );
  offset += 1;

  governanceBuffer.writeBigUInt64LE(
    BigInt(governanceConfig.minCouncilWeightToCreateProposal),
    offset
  );
  offset += 8;

  governanceBuffer.writeUInt8(governanceConfig.councilVoteTipping, offset);
  offset += 1;

  governanceBuffer.writeUInt8(1, offset); // YesVotePercentage type
  offset += 1;
  governanceBuffer.writeUInt8(
    governanceConfig.communityVetoVoteThreshold,
    offset
  );
  offset += 1;

  governanceBuffer.writeUInt32LE(governanceConfig.votingCoolOffTime, offset);
  offset += 4;

  governanceBuffer.writeUInt8(
    governanceConfig.depositExemptProposalCount,
    offset
  );
  offset += 1;

  // Write reservedV2
  governanceData.reservedV2.forEach((value) => {
    governanceBuffer.writeUInt8(value, offset);
    offset += 1;
  });

  // Write required signatories count
  governanceBuffer.writeUInt8(governanceData.requiredSignatoriesCount, offset);
  offset += 1;

  // Write active proposal count
  governanceBuffer.writeBigUInt64LE(
    BigInt(governanceData.activeProposalCount),
    offset
  );
  offset += 8;

  context.setAccount(governanceAccount, {
    lamports: 1_000_000_000,
    data: governanceBuffer,
    owner: SPL_GOVERNANCE_PROGRAM_ID,
    executable: false,
  });
}

// Used to create a "staked" balance for a user in a specific Realm
export function createGovernanceTokenRecord(
  context: LiteSVM,
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

export function createRealm(
  context: LiteSVM,
  realmOwner: PublicKey,
  realm: PublicKey,
  realmName: string,
  governanceTokenMint: PublicKey,
  councilMint: PublicKey = Keypair.generate().publicKey
) {
  // Create RealmConfig
  const config = {
    legacy1: 0,
    legacy2: 0,
    reserved: new Array(6).fill(0),
    minCommunityWeightToCreateGovernance: BigInt(0),
    communityMintMaxVoterWeightSource: { type: 0, value: BigInt(0) },
    councilMint,
  };

  // Create RealmV2
  const realmData = {
    accountType: 16, // Realm V2
    communityMint: governanceTokenMint,
    config: config,
    reserved: new Array(6).fill(0),
    legacy1: 0,
    authority: realmOwner,
    name: realmName,
    reservedV2: new Array(128).fill(0),
  };

  const realmBuffer = Buffer.alloc(304);
  let offset = 0;

  realmBuffer.writeUInt8(realmData.accountType, offset);
  offset += 1;

  governanceTokenMint.toBuffer().copy(realmBuffer, offset);
  offset += 32;

  realmBuffer.writeUInt8(realmData.config.legacy1, offset);
  offset += 1;

  realmBuffer.writeUInt8(realmData.config.legacy2, offset);
  offset += 1;

  realmData.config.reserved.forEach((value) => {
    realmBuffer.writeUInt8(value, offset);
    offset += 1;
  });

  realmBuffer.writeBigUInt64LE(
    realmData.config.minCommunityWeightToCreateGovernance,
    offset
  );
  offset += 8;

  realmBuffer.writeUInt8(
    realmData.config.communityMintMaxVoterWeightSource.type,
    offset
  );
  offset += 1;
  realmBuffer.writeBigUInt64LE(
    realmData.config.communityMintMaxVoterWeightSource.value,
    offset
  );
  offset += 8;

  // Write council_mint option
  if (councilMint) {
    realmBuffer.writeUInt8(1, offset); // Some
    offset += 1;
    councilMint.toBuffer().copy(realmBuffer, offset);
    offset += 32;
  } else {
    realmBuffer.writeUInt8(0, offset); // None
    offset += 1;
  }

  realmData.reserved.forEach((value) => {
    realmBuffer.writeUInt8(value, offset);
    offset += 1;
  });

  realmBuffer.writeUint16LE(realmData.legacy1, offset);
  offset += 2;

  // Write authority option
  if (realmData.authority) {
    realmBuffer.writeUInt8(1, offset); // Some
    offset += 1;
    realmData.authority.toBuffer().copy(realmBuffer, offset);
    offset += 32;
  } else {
    realmBuffer.writeUInt8(0, offset); // None
    offset += 1;
  }

  // Write name
  const nameBuffer = Buffer.from(realmData.name);
  realmBuffer.writeUInt32LE(nameBuffer.length, offset);
  offset += 4;
  nameBuffer.copy(realmBuffer, offset);
  offset += nameBuffer.length;

  realmBuffer.fill(0, offset, offset + 128);
  offset += 128;

  context.setAccount(realm, {
    lamports: 1_000_000_000,
    data: realmBuffer,
    owner: SPL_GOVERNANCE_PROGRAM_ID,
    executable: false,
  });
}

// This is a token account that holds all the staked governance tokens for a Realm.
// It is just a normal token account where the owner is the realm and the mint is the governance token
export function createGovernanceHoldingAccount(
  context: LiteSVM,
  governanceOwner: PublicKey,
  governanceTokenMint: PublicKey,
  governanceHoldingPda: PublicKey,
  balance: BN
) {
  const tokenAccData = Buffer.alloc(ACCOUNT_SIZE);
  AccountLayout.encode(
    {
      mint: governanceTokenMint,
      owner: governanceOwner,
      amount: BigInt(balance.toString()),
      delegateOption: 0,
      delegate: PublicKey.default,
      delegatedAmount: BigInt(0),
      state: 1,
      isNativeOption: 0,
      isNative: BigInt(0),
      closeAuthorityOption: 0,
      closeAuthority: PublicKey.default,
    },
    tokenAccData
  );

  context.setAccount(governanceHoldingPda, {
    lamports: 1_000_000_000,
    data: tokenAccData,
    owner: TOKEN_PROGRAM_ID,
    executable: false,
  });
}

// Used to execute a proposal, via a proposal transaction.
export async function executeGovernanceInstruction(
  context: LiteSVM,
  executor: Keypair,
  governanceAccount: PublicKey,
  governanceMint: PublicKey,
  instructions: TransactionInstruction[]
): Promise<BanksTransactionResultWithMeta> {
  const { proposalAddress, proposalTransactionAddress } =
    createProposalWithInstructions(
      context,
      governanceAccount,
      executor.publicKey,
      governanceMint,
      instructions
    );

  // Create execute instruction
  const executeIx = {
    programId: SPL_GOVERNANCE_PROGRAM_ID,
    keys: [
      { pubkey: governanceAccount, isSigner: false, isWritable: false },
      { pubkey: proposalAddress, isSigner: false, isWritable: true },
      { pubkey: proposalTransactionAddress, isSigner: false, isWritable: true },
      { pubkey: executor.publicKey, isSigner: true, isWritable: false },
    ],
    // ExecuteTransaction instruction discriminator (12)
    data: Buffer.from([16]),
  };

  // Add the instruction accounts that need to be executed
  if (instructions.length > 0) {
    instructions.forEach((ix) => {
      executeIx.keys.push({
        pubkey: ix.programId,
        isSigner: false,
        isWritable: false,
      });
      ix.keys.forEach((key) => {
        // Got this little hacky thing to make the governance PDA not as signer in the transaction
        // since it'll fail at transaction signature when sending, but we want the governance program
        // to call our program with the governance account as a signer, hence why we disable it
        // in the first instruction, but leave it there in the cpi call.
        if (key.pubkey.equals(governanceAccount)) {
          executeIx.keys.push({
            ...key,
            isSigner: false,
          });
        } else {
          executeIx.keys.push(key);
        }
      });
    });
  }

  return await createAndProcessTransaction(
    context,
    executor,
    [...getComputeLimitInstruction(800_000), executeIx],
    []
  );
}

// Setup function to help create all governance accounts needed for testing cases
export async function setupGovernanceAccounts(
  context: LiteSVM,
  ownerKeypair: Keypair,
  governanceMint: PublicKey
): Promise<{
  realmPDA: PublicKey;
  folioOwnerPDA: PublicKey;
  rewardsAdminPDA: PublicKey;
}> {
  initToken(
    context,
    // We don't care about who owns it
    ownerKeypair.publicKey,
    governanceMint,
    DEFAULT_DECIMALS,
    new BN(0)
  );

  const realmPDA = getRealmPDA("Test Realm");
  createRealm(
    context,
    // We don't care about who owns it
    ownerKeypair.publicKey,
    realmPDA,
    "Test Realm",
    governanceMint
  );

  const governanceSeed = Keypair.generate().publicKey;
  const folioOwnerPDA = getGovernanceAccountPDA(realmPDA, governanceSeed);
  createGovernanceAccount(context, realmPDA, folioOwnerPDA, governanceSeed);

  const governanceSeedRewards = Keypair.generate().publicKey;
  const rewardsAdminPDA = getGovernanceAccountPDA(
    realmPDA,
    governanceSeedRewards
  );
  createGovernanceAccount(
    context,
    realmPDA,
    rewardsAdminPDA,
    governanceSeedRewards
  );

  return { realmPDA, folioOwnerPDA, rewardsAdminPDA };
}
