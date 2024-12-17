import { BN } from "@coral-xyz/anchor";
import {
  AccountMeta,
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  GovernanceAccount,
  GovernanceConfig,
  RealmV2,
  SplGovernance,
  Vote,
} from "governance-idl-sdk";
import { cSendAndConfirmTxn } from "../program-helper";
import { getOrCreateAtaAddress } from "../token-helper";

let governanceClient: SplGovernance = null;

export function getGovernanceClient(connection: Connection): SplGovernance {
  if (!governanceClient) {
    // @ts-ignore
    governanceClient = new SplGovernance(connection);
  }
  return governanceClient;
}

export async function createRealm(
  connection: Connection,
  communityTokenMint: PublicKey,
  communityTokenAmount: BN,
  creator: Keypair,
  name: string,
  maxVoterWeightAmount: number
): Promise<RealmV2> {
  try {
    const governanceClient = getGovernanceClient(connection);

    const realmIx = await governanceClient.createRealmInstruction(
      name,
      communityTokenMint,
      communityTokenAmount,
      creator.publicKey,
      { type: "absolute", amount: new BN(maxVoterWeightAmount) }
    );

    await cSendAndConfirmTxn(connection, [realmIx], creator);

    return governanceClient.getRealmByName(name);
  } catch (error) {
    console.log("Error creating realm", error);
    throw error;
  }
}

export async function createGovernanceAccount(
  connection: Connection,
  realm: PublicKey,
  creator: Keypair
): Promise<{
  governanceAccounts: GovernanceAccount[];
  treasury: PublicKey;
}> {
  const governanceConfig: GovernanceConfig = {
    communityVoteThreshold: { yesVotePercentage: [60] },
    minCommunityWeightToCreateProposal: 1,
    minTransactionHoldUpTime: 0,
    votingBaseTime: 10,
    communityVoteTipping: { early: {} },
    councilVoteThreshold: { disabled: {} },
    councilVetoVoteThreshold: { disabled: {} },
    minCouncilWeightToCreateProposal: 1,
    councilVoteTipping: { disabled: {} },
    communityVetoVoteThreshold: { disabled: {} },
    votingCoolOffTime: 0,
    depositExemptProposalCount: 254,
  };

  try {
    const governanceClient = getGovernanceClient(connection);

    const governanceIx = await governanceClient.createGovernanceInstruction(
      governanceConfig,
      realm,
      creator.publicKey,
      undefined,
      creator.publicKey
    );

    await cSendAndConfirmTxn(connection, [governanceIx], creator);

    const governanceAccounts =
      await governanceClient.getGovernanceAccountsByRealm(realm);

    const treasuryIx = await governanceClient.createNativeTreasuryInstruction(
      governanceAccounts[0].publicKey,
      creator.publicKey
    );

    await cSendAndConfirmTxn(connection, [treasuryIx], creator);

    return {
      governanceAccounts,
      treasury: governanceClient.pda.nativeTreasuryAccount({
        governanceAccount: governanceAccounts[0].publicKey,
      }).publicKey,
    };
  } catch (error) {
    console.log("Error creating governance account", error);
    throw error;
  }
}

export async function depositGoverningTokens(
  connection: Connection,
  depositor: Keypair,
  realm: PublicKey,
  communityTokenMint: PublicKey,
  amount: BN
) {
  try {
    const depositorAta = await getOrCreateAtaAddress(
      connection,
      communityTokenMint,
      depositor,
      depositor.publicKey
    );

    const governanceClient = getGovernanceClient(connection);

    const depositIx = await governanceClient.depositGoverningTokensInstruction(
      realm,
      communityTokenMint,
      depositorAta,
      depositor.publicKey,
      depositor.publicKey,
      depositor.publicKey,
      amount
    );

    await cSendAndConfirmTxn(connection, [depositIx], depositor);
  } catch (error) {
    console.log("Error depositing governing tokens", error);
    throw error;
  }
}

export async function createProposal(
  connection: Connection,
  creator: Keypair,
  realm: PublicKey,
  governanceAccount: PublicKey,
  governingTokenMint: PublicKey,
  governanceAuthority: PublicKey,
  name: string,
  description: string,
  options: [string]
): Promise<{ proposalAccount: PublicKey }> {
  try {
    const governanceClient = getGovernanceClient(connection);

    const governanceTokenOwnerRecord =
      governanceClient.pda.tokenOwnerRecordAccount({
        realmAccount: realm,
        governingTokenMintAccount: governingTokenMint,
        governingTokenOwner: governanceAuthority,
      });

    const proposalIx = await governanceClient.createProposalInstruction(
      name,
      description,
      { choiceType: "single", multiChoiceOptions: null },
      options,
      true,
      realm,
      governanceAccount,
      governanceTokenOwnerRecord.publicKey,
      governingTokenMint,
      governanceAuthority,
      creator.publicKey,
      creator.publicKey // Seeds the proposal account
    );

    await cSendAndConfirmTxn(connection, [proposalIx], creator);

    return {
      proposalAccount: governanceClient.pda.proposalAccount({
        governanceAccount: governanceAccount,
        proposalSeed: creator.publicKey,
        governingTokenMint: governingTokenMint,
      }).publicKey,
    };
  } catch (error) {
    console.log("Error creating proposal", error);
    throw error;
  }
}

export async function addInstructionsToProposal(
  connection: Connection,
  creator: Keypair,
  realm: PublicKey,
  governingTokenMint: PublicKey,
  governanceAccount: PublicKey,
  governanceAuthority: PublicKey,
  proposalAccount: PublicKey,
  instructions: TransactionInstruction[]
): Promise<PublicKey> {
  try {
    const governanceClient = getGovernanceClient(connection);

    const governanceTokenOwnerRecord =
      governanceClient.pda.tokenOwnerRecordAccount({
        realmAccount: realm,
        governingTokenMintAccount: governingTokenMint,
        governingTokenOwner: governanceAuthority,
      });

    const addInstructionsIx =
      await governanceClient.insertTransactionInstruction(
        instructions,
        0, // Option index for "passing"
        0,
        1,
        governanceAccount,
        proposalAccount,
        governanceTokenOwnerRecord.publicKey,
        governanceAuthority,
        creator.publicKey
      );

    await cSendAndConfirmTxn(connection, [addInstructionsIx], creator);

    return governanceClient.pda.proposalTransactionAccount({
      proposal: proposalAccount,
      optionIndex: 0,
      index: 0,
    }).publicKey;
  } catch (error) {
    console.log("Error adding instructions to proposal", error);
    throw error;
  }
}

export async function signOffProposal(
  connection: Connection,
  creator: Keypair,
  realm: PublicKey,
  governanceAccount: PublicKey,
  proposalAccount: PublicKey,
  governanceAuthority: PublicKey,
  governingTokenMint: PublicKey
) {
  try {
    const governanceClient = getGovernanceClient(connection);

    const governanceTokenOwnerRecord =
      governanceClient.pda.tokenOwnerRecordAccount({
        realmAccount: realm,
        governingTokenMintAccount: governingTokenMint,
        governingTokenOwner: governanceAuthority,
      });

    const signOffIx = await governanceClient.signOffProposalInstruction(
      realm,
      governanceAccount,
      proposalAccount,
      creator.publicKey,
      governanceTokenOwnerRecord.publicKey
    );

    await cSendAndConfirmTxn(connection, [signOffIx], creator);
  } catch (error) {
    console.log("Error signing off proposal", error);
    throw error;
  }
}

export async function castVote(
  connection: Connection,
  voter: Keypair,
  realm: PublicKey,
  governanceAccount: PublicKey,
  governanceAuthority: PublicKey,
  governingTokenMint: PublicKey,
  proposalAccount: PublicKey,
  proposalOwner: PublicKey,
  vote: Vote
): Promise<{
  signature: string;
  error: Error;
}> {
  try {
    const governanceClient = getGovernanceClient(connection);

    const proposalOwnerTokenOwnerRecord =
      governanceClient.pda.tokenOwnerRecordAccount({
        realmAccount: realm,
        governingTokenMintAccount: governingTokenMint,
        governingTokenOwner: proposalOwner,
      });

    const voterTokenOwnerRecord = governanceClient.pda.tokenOwnerRecordAccount({
      realmAccount: realm,
      governingTokenMintAccount: governingTokenMint,
      governingTokenOwner: voter.publicKey,
    });

    const voteIx = await governanceClient.castVoteInstruction(
      vote,
      realm,
      governanceAccount,
      proposalAccount,
      proposalOwnerTokenOwnerRecord.publicKey,
      voterTokenOwnerRecord.publicKey,
      governanceAuthority,
      governingTokenMint,
      voter.publicKey
    );

    const voteSignature = await cSendAndConfirmTxn(connection, [voteIx], voter);

    if (voteSignature.error) {
      throw voteSignature.error;
    }

    return voteSignature;
  } catch (error) {
    console.log("Error casting vote", error);
    throw error;
  }
}

export async function finalizeVote(
  connection: Connection,
  creator: Keypair,
  realm: PublicKey,
  governanceAccount: PublicKey,
  proposalAccount: PublicKey,
  proposalOwner: PublicKey,
  governingTokenMint: PublicKey
): Promise<{
  signature: string;
  error: Error;
}> {
  try {
    const governanceClient = getGovernanceClient(connection);

    const proposalOwnerTokenOwnerRecord =
      governanceClient.pda.tokenOwnerRecordAccount({
        realmAccount: realm,
        governingTokenMintAccount: governingTokenMint,
        governingTokenOwner: proposalOwner,
      });

    const finalizeVoteIx = await governanceClient.finalizeVoteInstruction(
      realm,
      governanceAccount,
      proposalAccount,
      proposalOwnerTokenOwnerRecord.publicKey,
      governingTokenMint
    );

    const finalizeVoteSignature = await cSendAndConfirmTxn(
      connection,
      [finalizeVoteIx],
      creator
    );

    if (finalizeVoteSignature.error) {
      throw finalizeVoteSignature.error;
    }

    return finalizeVoteSignature;
  } catch (error) {
    console.log("Error finalizing vote", error);
    throw error;
  }
}

export async function executeTransaction(
  connection: Connection,
  creator: Keypair,
  governanceAccount: PublicKey,
  proposalAccount: PublicKey,
  proposalTransactionAccount: PublicKey,
  transactionAccounts: AccountMeta[]
): Promise<{
  signature: string;
  error: Error;
}> {
  try {
    const governanceClient = getGovernanceClient(connection);

    const executeTransactionIx =
      await governanceClient.executeTransactionInstruction(
        governanceAccount,
        proposalAccount,
        proposalTransactionAccount,
        transactionAccounts
      );

    const executeTransactionSignature = await cSendAndConfirmTxn(
      connection,
      [executeTransactionIx],
      creator
    );

    if (executeTransactionSignature.error) {
      throw executeTransactionSignature.error;
    }

    return executeTransactionSignature;
  } catch (error) {
    console.log("Error executing transaction", error);
    throw error;
  }
}
