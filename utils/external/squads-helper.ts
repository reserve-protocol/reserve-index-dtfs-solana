import { BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import Squads, {
  DEFAULT_MULTISIG_PROGRAM_ID,
  getAuthorityPDA,
  MultisigAccount,
  Wallet,
} from "@sqds/sdk";

/**
 * Helper functions for interacting with Squads Protocol's multisig program.
 * Provides utilities for creating and managing multisig wallets, including
 * member management, transaction creation, approval flows, and execution.
 * Simplifies the interaction with Squads' multisignature functionality.
 *
 * Those functionalities are mainly used as an example on how front-ends, tests, etc. could use these
 * functions to guide them.
 */

// For authority index explanation, see: https://docs.squads.so/main/squads-legacy/development/authorities, will most of the time be 1
export const DEFAULT_AUTHORITY_INDEX: number = 1;
export const DEFAULT_INTERNAL_AUTHORITY_INDEX: number = 0; // For squads instructions like add member, etc.

let squadsClient: Squads = null;

export function getSquadsClient(creator: Keypair): Squads {
  if (!squadsClient || squadsClient.wallet.publicKey !== creator.publicKey) {
    squadsClient = Squads.localnet(new Wallet(creator));
  }
  return squadsClient;
}

export async function createSquad(
  creator: Keypair,
  createKey: Keypair = Keypair.generate(),
  members: PublicKey[] = [],
  threshold: number = 1,
  name: string = "test",
  description: string = "test"
): Promise<{ multisigAccount: MultisigAccount; vault: PublicKey }> {
  const squads = getSquadsClient(creator);

  try {
    const multisigAccount = await squads.createMultisig(
      threshold,
      createKey.publicKey,
      [...members, creator.publicKey],
      name,
      description
    );

    const [vault] = getAuthorityPDA(
      multisigAccount.publicKey,
      new BN(DEFAULT_AUTHORITY_INDEX),
      DEFAULT_MULTISIG_PROGRAM_ID
    );

    return {
      multisigAccount,
      vault,
    };
  } catch (e) {
    console.log("Error creating squad", e);
    throw e;
  }
}

export async function addMember(
  creator: Keypair,
  multisigAccount: MultisigAccount,
  newMember: PublicKey,
  changeThreshold: boolean = false
): Promise<PublicKey> {
  const squads = getSquadsClient(creator);

  try {
    let txnBuilder = await squads.getTransactionBuilder(
      multisigAccount.publicKey,
      DEFAULT_INTERNAL_AUTHORITY_INDEX
    );

    if (changeThreshold) {
      txnBuilder = await txnBuilder.withAddMemberAndChangeThreshold(
        newMember,
        multisigAccount.threshold + 1
      );
    } else {
      txnBuilder = await txnBuilder.withAddMember(newMember);
    }

    const [_txInstructions, txPDA] = await txnBuilder.executeInstructions();

    // To make transaction signable, we need to activate it
    await squads.activateTransaction(txPDA);

    return txPDA;
  } catch (e) {
    console.log("Error adding member to squad", e);
    throw e;
  }
}

export async function createGenericTransaction(
  signer: Keypair,
  multisigAccount: MultisigAccount,
  authorityIndex: number,
  instructions: TransactionInstruction[]
): Promise<PublicKey> {
  const squads = getSquadsClient(signer);

  try {
    const txn = await squads.createTransaction(
      multisigAccount.publicKey,
      authorityIndex
    );

    for (const instruction of instructions) {
      await squads.addInstruction(txn.publicKey, instruction);
    }

    await squads.activateTransaction(txn.publicKey);

    return txn.publicKey;
  } catch (e) {
    console.log("Error creating generic transaction", e);
    throw e;
  }
}

export async function approveTransaction(signer: Keypair, txPDA: PublicKey) {
  const squads = getSquadsClient(signer);

  try {
    await squads.approveTransaction(txPDA);
  } catch (e) {
    console.log("Error approving transaction", e);
    throw e;
  }
}

export async function rejectTransaction(signer: Keypair, txPDA: PublicKey) {
  const squads = getSquadsClient(signer);

  try {
    await squads.rejectTransaction(txPDA);
  } catch (e) {
    console.log("Error rejecting transaction", e);
    throw e;
  }
}

export async function executeTransaction(signer: Keypair, txPDA: PublicKey) {
  try {
    const squads = getSquadsClient(signer);

    await squads.executeTransaction(txPDA);
  } catch (e) {
    console.log("Error executing transaction", e);
    throw e;
  }
}
