import { PublicKey } from "@solana/web3.js";
import {
  FOLIO_PROGRAM_ID,
  FOLIO_ADMIN_PROGRAM_ID,
  TOKEN_METADATA_PROGRAM_ID,
  SPL_GOVERNANCE_PROGRAM_ID,
  FOLIO_SECOND_PROGRAM_ID,
  REWARDS_PROGRAM_ID,
} from "./constants";
import BN from "bn.js";

/**
 * Collection of functions for generating PDAs used
 * throughout the Folio protocol. Provides consistent PDA derivation for various
 * protocol accounts and features. Some include the bump when required.
 */

export function getProgramRegistrarPDA() {
  return getProgramRegistrarPDAWithBump()[0];
}

export function getProgramRegistrarPDAWithBump() {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("program_registrar")],
    FOLIO_ADMIN_PROGRAM_ID
  );
}

export function getFolioPDA(
  folioTokenMint: PublicKey,
  useSecondFolioProgram: boolean = false
) {
  return getFolioPDAWithBump(folioTokenMint, useSecondFolioProgram)[0];
}

export function getFolioPDAWithBump(
  folioTokenMint: PublicKey,
  useSecondFolioProgram: boolean = false
) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("folio"), folioTokenMint.toBuffer()],
    useSecondFolioProgram ? FOLIO_SECOND_PROGRAM_ID : FOLIO_PROGRAM_ID
  );
}

export function getActorPDA(
  authority: PublicKey,
  folioPDA: PublicKey,
  useSecondFolioProgram: boolean = false
) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("actor"), authority.toBuffer(), folioPDA.toBuffer()],
    useSecondFolioProgram ? FOLIO_SECOND_PROGRAM_ID : FOLIO_PROGRAM_ID
  )[0];
}

export function getActorPDAWithBump(authority: PublicKey, folioPDA: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("actor"), authority.toBuffer(), folioPDA.toBuffer()],
    FOLIO_PROGRAM_ID
  );
}
export function getAuctionEndsPDA(
  folio: PublicKey,
  rebalanceNonce: BN,
  token1Input: PublicKey,
  token2Input: PublicKey
) {
  const compare = token1Input.toBuffer().compare(token2Input.toBuffer());
  let token1 = token1Input;
  let token2 = token2Input;
  if (compare > 0) {
    token1 = token2Input;
    token2 = token1Input;
  }

  return getAuctionEndsPDAWithBump(folio, rebalanceNonce, token1, token2)[0];
}

export function getAuctionEndsPDAWithBump(
  folio: PublicKey,
  rebalanceNonce: BN,
  token1: PublicKey,
  token2: PublicKey
) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("auction_ends"),
      folio.toBuffer(),
      rebalanceNonce.toBuffer("le", 8),
      token1.toBuffer(),
      token2.toBuffer(),
    ],
    FOLIO_PROGRAM_ID
  );
}

export function getDAOFeeConfigPDA() {
  return getDaoFeeConfigPDAWithBump()[0];
}

export function getDaoFeeConfigPDAWithBump() {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("dao_fee_config")],
    FOLIO_ADMIN_PROGRAM_ID
  );
}

export function getFolioFeeConfigPDA(folio: PublicKey) {
  return getFolioFeeConfigPDAWithBump(folio)[0];
}

export function getFolioFeeConfigPDAWithBump(folio: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("folio_fee_config"), folio.toBuffer()],
    FOLIO_ADMIN_PROGRAM_ID
  );
}

export function getTVLFeeRecipientsPDA(folio: PublicKey) {
  return getTVLFeeRecipientsPDAWithBump(folio)[0];
}

export function getTVLFeeRecipientsPDAWithBump(folio: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("fee_recipients"), folio.toBuffer()],
    FOLIO_PROGRAM_ID
  );
}

export function getFolioBasketPDA(folio: PublicKey, programId?: PublicKey) {
  return getFolioBasketPDAWithBump(folio, programId)[0];
}

export function getFolioBasketPDAWithBump(
  folio: PublicKey,
  programId: PublicKey = FOLIO_PROGRAM_ID
) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("folio_basket"), folio.toBuffer()],
    programId
  );
}

export function getUserPendingBasketPDA(folio: PublicKey, user: PublicKey) {
  return getUserPendingBasketPDAWithBump(folio, user)[0];
}

export function getUserPendingBasketPDAWithBump(
  folio: PublicKey,
  user: PublicKey
) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("user_pending_basket"), folio.toBuffer(), user.toBuffer()],
    FOLIO_PROGRAM_ID
  );
}

export function getMetadataPDA(mint: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ],
    TOKEN_METADATA_PROGRAM_ID
  )[0];
}

export function getFeeDistributionPDA(folio: PublicKey, index: BN) {
  return getFeeDistributionPDAWithBump(folio, index)[0];
}

export function getRebalancePDA(folio: PublicKey) {
  return getRebalancePDAWithBump(folio)[0];
}

export function getRebalancePDAWithBump(folio: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("rebalance"), folio.toBuffer()],
    FOLIO_PROGRAM_ID
  );
}
export function getFeeDistributionPDAWithBump(folio: PublicKey, index: BN) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("fee_distribution"),
      folio.toBuffer(),
      index.toBuffer("le", 8),
    ],
    FOLIO_PROGRAM_ID
  );
}

export function getAuctionPDA(
  folio: PublicKey,
  rebalanceNonce: BN,
  auctionId: BN
) {
  return getAuctionPDAWithBump(folio, rebalanceNonce, auctionId)[0];
}

export function getAuctionPDAWithBump(
  folio: PublicKey,
  rebalanceNonce: BN,
  auctionId: BN
) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("auction"),
      folio.toBuffer(),
      rebalanceNonce.toBuffer("le", 8),
      auctionId.toBuffer("le", 8),
    ],
    FOLIO_PROGRAM_ID
  );
}

export function getRewardTokensPDA(realm: PublicKey) {
  return getRewardTokensPDAWithBump(realm)[0];
}

export function getRewardTokensPDAWithBump(realm: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("reward_tokens"), realm.toBuffer()],
    REWARDS_PROGRAM_ID
  );
}

export function getRewardInfoPDA(realm: PublicKey, rewardToken: PublicKey) {
  return getRewardInfoPDAWithBump(realm, rewardToken)[0];
}

export function getRewardInfoPDAWithBump(
  realm: PublicKey,
  rewardToken: PublicKey
) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("reward_info"), realm.toBuffer(), rewardToken.toBuffer()],
    REWARDS_PROGRAM_ID
  );
}

export function getUserRewardInfoPDA(
  realm: PublicKey,
  rewardToken: PublicKey,
  user: PublicKey
) {
  return getUserRewardInfoPDAWithBump(realm, rewardToken, user)[0];
}

export function getUserRewardInfoPDAWithBump(
  realm: PublicKey,
  rewardToken: PublicKey,
  user: PublicKey
) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("user_reward_info"),
      realm.toBuffer(),
      rewardToken.toBuffer(),
      user.toBuffer(),
    ],
    REWARDS_PROGRAM_ID
  );
}

/*
SPL Governance related PDAs
*/
export function getUserTokenRecordRealmsPDA(
  realm: PublicKey,
  governanceTokenMint: PublicKey,
  user: PublicKey
) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("governance"),
      realm.toBuffer(),
      governanceTokenMint.toBuffer(),
      user.toBuffer(),
    ],
    SPL_GOVERNANCE_PROGRAM_ID
  )[0];
}

export function getGovernanceHoldingPDA(
  realm: PublicKey,
  governanceTokenMint: PublicKey
) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("governance"),
      realm.toBuffer(),
      governanceTokenMint.toBuffer(),
    ],
    SPL_GOVERNANCE_PROGRAM_ID
  )[0];
}

export function getRealmPDA(name: string) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("governance"), Buffer.from(name)],
    SPL_GOVERNANCE_PROGRAM_ID
  )[0];
}

export function getGovernanceAccountPDA(
  realm: PublicKey,
  governanceAccount: PublicKey
) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("account-governance"),
      realm.toBuffer(),
      governanceAccount.toBuffer(),
    ],
    SPL_GOVERNANCE_PROGRAM_ID
  )[0];
}

export function getProposalPDA(
  governanceAccount: PublicKey,
  governingTokenMint: PublicKey,
  proposalSeed: PublicKey
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("governance"),
      governanceAccount.toBuffer(),
      governingTokenMint.toBuffer(),
      proposalSeed.toBuffer(),
    ],
    SPL_GOVERNANCE_PROGRAM_ID
  )[0];
}

export function getProposalTransactionPDA(
  proposalPda: PublicKey,
  optionIndex: number,
  instructionIndex: number
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("proposal-transaction"),
      proposalPda.toBuffer(),
      Buffer.from([optionIndex]),
      Buffer.from([instructionIndex]),
    ],
    SPL_GOVERNANCE_PROGRAM_ID
  )[0];
}
