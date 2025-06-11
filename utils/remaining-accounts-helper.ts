import { BN } from "@coral-xyz/anchor";
import { AccountMeta, Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  getRewardInfoPDA,
  getRewardTokensPDA,
  getUserRewardInfoPDA,
} from "./pda-helper";
import { getOrCreateAtaAddress } from "./token-helper";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

/**
 * Helper functions for building remaining accounts arrays required for various
 * Folio / Rewards program instructions. Handles account setup for rewards, token operations,
 * and migrations.
 */

// Builds remaining accounts for basket operations, from adding to basket to removing from basket.
export async function buildRemainingAccounts(
  connection: Connection,
  payerKeypair: Keypair,
  tokens: { mint: PublicKey; amount: BN }[],
  senderAddress: PublicKey = null,
  recipientAddress: PublicKey = null,
  includeMint: boolean = true,
  includeTokenProgram: boolean = false,
  tokenProgram: PublicKey = TOKEN_PROGRAM_ID
): Promise<AccountMeta[]> {
  const remainingAccounts: AccountMeta[] = [];

  for (const token of tokens) {
    if (includeTokenProgram) {
      remainingAccounts.push({
        pubkey: tokenProgram,
        isSigner: false,
        isWritable: false,
      });
    }

    if (includeMint) {
      remainingAccounts.push({
        pubkey: token.mint,
        isSigner: false,
        isWritable: false,
      });
    }
    if (senderAddress) {
      remainingAccounts.push({
        pubkey: await getOrCreateAtaAddress(
          connection,
          token.mint,
          payerKeypair,
          senderAddress,
          tokenProgram
        ),
        isSigner: false,
        isWritable: true,
      });
    }
    if (recipientAddress) {
      remainingAccounts.push({
        pubkey: await getOrCreateAtaAddress(
          connection,
          token.mint,
          payerKeypair,
          recipientAddress,
          tokenProgram
        ),
        isSigner: false,
        isWritable: true,
      });
    }
  }

  return remainingAccounts;
}

export async function buildRemainingAccountsForAccruesRewards(
  connection: Connection,
  callerKeypair: Keypair,
  realm: PublicKey,
  rewardTokens: PublicKey[],
  extraUser: PublicKey = callerKeypair.publicKey
): Promise<AccountMeta[]> {
  const remainingAccounts: AccountMeta[] = [];

  const rewardTokensPDA = getRewardTokensPDA(realm);

  for (const token of rewardTokens) {
    remainingAccounts.push({
      pubkey: token,
      isSigner: false,
      isWritable: false,
    });

    remainingAccounts.push({
      pubkey: getRewardInfoPDA(realm, token),
      isSigner: false,
      isWritable: true,
    });

    remainingAccounts.push({
      pubkey: await getOrCreateAtaAddress(
        connection,
        token,
        callerKeypair,
        rewardTokensPDA
      ),
      isSigner: false,
      isWritable: false,
    });

    remainingAccounts.push({
      pubkey: getUserRewardInfoPDA(realm, token, callerKeypair.publicKey),
      isSigner: false,
      isWritable: true,
    });

    if (extraUser.toString() !== callerKeypair.publicKey.toString()) {
      remainingAccounts.push({
        pubkey: getUserRewardInfoPDA(realm, token, extraUser),
        isSigner: false,
        isWritable: true,
      });
    }
  }

  return remainingAccounts;
}

export async function buildRemainingAccountsForClaimRewards(
  connection: Connection,
  callerKeypair: Keypair,
  realm: PublicKey,
  rewardTokens: PublicKey[]
): Promise<AccountMeta[]> {
  const remainingAccounts: AccountMeta[] = [];

  const rewardTokensPDA = getRewardTokensPDA(realm);

  for (const token of rewardTokens) {
    remainingAccounts.push({
      pubkey: token,
      isSigner: false,
      isWritable: false,
    });

    remainingAccounts.push({
      pubkey: getRewardInfoPDA(realm, token),
      isSigner: false,
      isWritable: true,
    });

    remainingAccounts.push({
      pubkey: await getOrCreateAtaAddress(
        connection,
        token,
        callerKeypair,
        rewardTokensPDA
      ),
      isSigner: false,
      isWritable: true,
    });

    remainingAccounts.push({
      pubkey: getUserRewardInfoPDA(realm, token, callerKeypair.publicKey),
      isSigner: false,
      isWritable: true,
    });

    remainingAccounts.push({
      pubkey: await getOrCreateAtaAddress(
        connection,
        token,
        callerKeypair,
        callerKeypair.publicKey
      ),
      isSigner: false,
      isWritable: true,
    });
  }

  return remainingAccounts;
}

export async function buildRemainingAccountsForMigrateFolioTokens(
  connection: Connection,
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
      pubkey: await getOrCreateAtaAddress(
        connection,
        token,
        userKeypair,
        oldFolio
      ),
      isSigner: false,
      isWritable: true,
    });

    remainingAccounts.push({
      pubkey: await getOrCreateAtaAddress(
        connection,
        token,
        userKeypair,
        newFolio
      ),
      isSigner: false,
      isWritable: true,
    });
  }

  return remainingAccounts;
}
