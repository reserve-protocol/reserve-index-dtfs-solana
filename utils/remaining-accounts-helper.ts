import { BN } from "@coral-xyz/anchor";
import { AccountMeta, Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  getFolioRewardTokensPDA,
  getRewardInfoPDA,
  getUserRewardInfoPDA,
} from "./pda-helper";
import { getOrCreateAtaAddress } from "./token-helper";

/**
 * Helper functions for building remaining accounts arrays required for various
 * Folio program instructions. Handles account setup for rewards, token operations,
 * and migrations.
 */

// Builds remaining accounts for basket operations, from adding to basket to removing from basket.
export async function buildRemainingAccounts(
  connection: Connection,
  payerKeypair: Keypair,
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
        pubkey: await getOrCreateAtaAddress(
          connection,
          token.mint,
          payerKeypair,
          senderAddress
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
  connection: Connection,
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
      pubkey: await getOrCreateAtaAddress(
        connection,
        token,
        callerKeypair,
        folioRewardTokensPDA
      ),
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
  connection: Connection,
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
      pubkey: await getOrCreateAtaAddress(
        connection,
        token,
        callerKeypair,
        folioRewardTokensPDA
      ),
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
