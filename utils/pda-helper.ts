import { PublicKey } from "@solana/web3.js";
import {
  FOLIO_PROGRAM_ID,
  DTF_PROGRAM_ID,
  TOKEN_METADATA_PROGRAM_ID,
  BPF_LOADER_PROGRAM_ID,
  SPL_GOVERNANCE_PROGRAM_ID,
} from "./constants";
import BN from "bn.js";

export function getProgramRegistrarPDA() {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("program_registrar")],
    FOLIO_PROGRAM_ID
  )[0];
}

export function getProgramRegistrarPDAWithBump() {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("program_registrar")],
    FOLIO_PROGRAM_ID
  );
}

export function getFolioPDA(folioTokenMint: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("folio"), folioTokenMint.toBuffer()],
    FOLIO_PROGRAM_ID
  )[0];
}

export function getFolioPDAWithBump(folioTokenMint: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("folio"), folioTokenMint.toBuffer()],
    FOLIO_PROGRAM_ID
  );
}

export function getActorPDA(authority: PublicKey, folioPDA: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("actor"), authority.toBuffer(), folioPDA.toBuffer()],
    FOLIO_PROGRAM_ID
  )[0];
}

export function getActorPDAWithBump(authority: PublicKey, folioPDA: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("actor"), authority.toBuffer(), folioPDA.toBuffer()],
    FOLIO_PROGRAM_ID
  );
}

export function getProgramDataPDA(programId: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [programId.toBuffer()],
    BPF_LOADER_PROGRAM_ID
  )[0];
}

export function getDtfSignerPDA() {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("dtf_program_signer")],
    DTF_PROGRAM_ID
  )[0];
}

export function getDtfSignerPDAWithBump() {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("dtf_program_signer")],
    DTF_PROGRAM_ID
  );
}

export function getDAOFeeConfigPDA() {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("dao_fee_config")],
    DTF_PROGRAM_ID
  )[0];
}

export function getDaoFeeConfigPDAWithBump() {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("dao_fee_config")],
    DTF_PROGRAM_ID
  );
}

export function getFolioFeeRecipientsPDA(folio: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("fee_recipients"), folio.toBuffer()],
    FOLIO_PROGRAM_ID
  )[0];
}

export function getFolioFeeRecipientsPDAWithBump(folio: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("fee_recipients"), folio.toBuffer()],
    FOLIO_PROGRAM_ID
  );
}

export function getFolioBasketPDA(folio: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("folio_basket"), folio.toBuffer()],
    FOLIO_PROGRAM_ID
  )[0];
}

export function getFolioBasketPDAWithBump(folio: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("folio_basket"), folio.toBuffer()],
    FOLIO_PROGRAM_ID
  );
}

export function getUserPendingBasketPDA(folio: PublicKey, user: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("user_pending_basket"), folio.toBuffer(), user.toBuffer()],
    FOLIO_PROGRAM_ID
  )[0];
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
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("fee_distribution"),
      folio.toBuffer(),
      index.toBuffer("le", 8),
    ],
    FOLIO_PROGRAM_ID
  )[0];
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

export function getTradePDA(folio: PublicKey, tradeId: BN) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("trade"), folio.toBuffer(), tradeId.toBuffer("le", 8)],
    FOLIO_PROGRAM_ID
  )[0];
}

export function getFolioRewardTokensPDA(folio: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("folio_reward_tokens"), folio.toBuffer()],
    FOLIO_PROGRAM_ID
  )[0];
}

export function getFolioRewardTokensPDAWithBump(folio: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("folio_reward_tokens"), folio.toBuffer()],
    FOLIO_PROGRAM_ID
  );
}

export function getRewardInfoPDA(folio: PublicKey, rewardToken: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("reward_info"), folio.toBuffer(), rewardToken.toBuffer()],
    FOLIO_PROGRAM_ID
  )[0];
}

export function getRewardInfoPDAWithBump(
  folio: PublicKey,
  rewardToken: PublicKey
) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("reward_info"), folio.toBuffer(), rewardToken.toBuffer()],
    FOLIO_PROGRAM_ID
  );
}

export function getUserRewardInfoPDA(
  folio: PublicKey,
  rewardToken: PublicKey,
  user: PublicKey
) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("user_reward_info"),
      folio.toBuffer(),
      rewardToken.toBuffer(),
      user.toBuffer(),
    ],
    FOLIO_PROGRAM_ID
  )[0];
}

export function getUserRewardInfoPDAWithBump(
  folio: PublicKey,
  rewardToken: PublicKey,
  user: PublicKey
) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("user_reward_info"),
      folio.toBuffer(),
      rewardToken.toBuffer(),
      user.toBuffer(),
    ],
    FOLIO_PROGRAM_ID
  );
}

export function getUserTokenRecordRealmsPDA(
  folioOwner: PublicKey, // Is the realm
  rewardToken: PublicKey,
  user: PublicKey
) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("governance"),
      folioOwner.toBuffer(),
      rewardToken.toBuffer(),
      user.toBuffer(),
    ],
    SPL_GOVERNANCE_PROGRAM_ID
  )[0];
}
