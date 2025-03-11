import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
import idlRewards from "../target/idl/rewards.json";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";
import {
  getComputeLimitInstruction,
  pSendAndConfirmTxn,
} from "./program-helper";
import {
  getRewardInfoPDA,
  getGovernanceHoldingPDA,
  getUserTokenRecordRealmsPDA,
  getRewardTokensPDA,
} from "./pda-helper";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { getOrCreateAtaAddress } from "./token-helper";
import {
  buildRemainingAccountsForAccruesRewards,
  buildRemainingAccountsForClaimRewards,
} from "./remaining-accounts-helper";
import { Rewards } from "../target/types/rewards";

let rewardsProgram: Program<Rewards> = null;

const SKIP_PREFLIGHT = true;

/**
 * Primary interface for most Rewards program operations.
 */

export function getRewardsProgram(
  connection: Connection,
  wallet: Keypair
): Program<Rewards> {
  if (
    !rewardsProgram ||
    rewardsProgram.provider.publicKey != wallet.publicKey
  ) {
    rewardsProgram = new Program<Rewards>(
      idlRewards as Rewards,
      new AnchorProvider(
        connection,
        new NodeWallet(wallet),
        AnchorProvider.defaultOptions()
      )
    );
  }

  return rewardsProgram;
}

/**
 * For now this function expects the signer to be a governance account (reward admin)
 * this doesn't directly work as the governance account is a PDA owned by the SPL governance program,
 * to test this we'd need to create the realms, do proposals, etc. so instead it'll be tested with bankrun for now.
 */
export async function setRewardsAdmin(
  connection: Connection,
  executor: Keypair,
  // Is a governance account
  rewardAdmin: Keypair,
  realm: PublicKey
) {
  const rewardsProgram = getRewardsProgram(connection, executor);

  const setRewardsAdmin = await rewardsProgram.methods
    .setRewardsAdmin()
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      executor: executor.publicKey,
      rewardAdmin: rewardAdmin.publicKey,
      realm,
      rewardTokens: getRewardTokensPDA(realm),
    })
    .instruction();

  await pSendAndConfirmTxn(rewardsProgram, [setRewardsAdmin], [rewardAdmin], {
    skipPreflight: SKIP_PREFLIGHT,
  });
}

/**
 * For now this function expects the signer to be a governance account (reward admin)
 * this doesn't directly work as the governance account is a PDA owned by the SPL governance program,
 * to test this we'd need to create the realms, do proposals, etc. so instead it'll be tested with bankrun for now.
 */
export async function addRewardToken(
  connection: Connection,
  executor: Keypair,
  // Is a governance account
  rewardAdmin: Keypair,
  realm: PublicKey,
  rewardToken: PublicKey
) {
  const rewardsProgram = getRewardsProgram(connection, executor);

  const addRewardToken = await rewardsProgram.methods
    .addRewardToken()
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      executor: executor.publicKey,
      rewardAdmin: rewardAdmin.publicKey,
      realm,
      rewardTokens: getRewardTokensPDA(realm),
      rewardTokenRewardInfo: getRewardInfoPDA(realm, rewardToken),
      rewardToken,
      rewardTokenAccount: await getOrCreateAtaAddress(
        connection,
        rewardToken,
        executor,
        getRewardTokensPDA(realm)
      ),
    })
    .instruction();

  await pSendAndConfirmTxn(rewardsProgram, [addRewardToken], [rewardAdmin], {
    skipPreflight: SKIP_PREFLIGHT,
  });
}

/**
 * For now this function expects the signer to be a governance account (reward admin)
 * this doesn't directly work as the governance account is a PDA owned by the SPL governance program,
 * to test this we'd need to create the realms, do proposals, etc. so instead it'll be tested with bankrun for now.
 */
export async function removeRewardToken(
  connection: Connection,
  executor: Keypair,
  // Is a governance account
  rewardAdmin: Keypair,
  realm: PublicKey,
  rewardTokenToRemove: PublicKey
) {
  const rewardsProgram = getRewardsProgram(connection, executor);

  const removeRewardToken = await rewardsProgram.methods
    .removeRewardToken()
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      executor: executor.publicKey,
      rewardAdmin: rewardAdmin.publicKey,
      realm,
      rewardTokens: getRewardTokensPDA(realm),
      rewardTokenToRemove,
    })
    .instruction();

  await pSendAndConfirmTxn(rewardsProgram, [removeRewardToken], [rewardAdmin], {
    skipPreflight: SKIP_PREFLIGHT,
  });
}

/**
 * For now this function expects the signer to be a governance account (reward admin)
 * this doesn't directly work as the governance account is a PDA owned by the SPL governance program,
 * to test this we'd need to create the realms, do proposals, etc. so instead it'll be tested with bankrun for now.
 */
export async function initOrSetRewardRatio(
  connection: Connection,
  executor: Keypair,
  // Is a governance account
  rewardAdmin: Keypair,
  realm: PublicKey,
  rewardPeriod: BN,
  governanceMint: PublicKey
) {
  const rewardsProgram = getRewardsProgram(connection, executor);

  const initOrSetRewardRatio = await rewardsProgram.methods
    .initOrSetRewardRatio(rewardPeriod)
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      executor: executor.publicKey,
      rewardAdmin: rewardAdmin.publicKey,
      realm,
      rewardTokens: getRewardTokensPDA(realm),
      governanceTokenMint: governanceMint,
      governanceStakedTokenAccount: getGovernanceHoldingPDA(
        realm,
        governanceMint
      ),
      callerGovernanceTokenAccount: getUserTokenRecordRealmsPDA(
        realm,
        governanceMint,
        executor.publicKey
      ),
    })
    .instruction();

  await pSendAndConfirmTxn(
    rewardsProgram,
    [initOrSetRewardRatio],
    [rewardAdmin],
    {
      skipPreflight: SKIP_PREFLIGHT,
    }
  );
}

export async function accrueRewards(
  connection: Connection,
  callerKeypair: Keypair,
  realm: PublicKey,
  rewardTokens: PublicKey[],
  governanceMint: PublicKey,
  extraUser: PublicKey = callerKeypair.publicKey
) {
  const rewardsProgram = getRewardsProgram(connection, callerKeypair);

  const accrueRewards = await rewardsProgram.methods
    .accrueRewards()
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      caller: callerKeypair.publicKey,
      realm,
      rewardTokens: getRewardTokensPDA(realm),
      governanceTokenMint: governanceMint,
      governanceStakedTokenAccount: getGovernanceHoldingPDA(
        realm,
        governanceMint
      ),
      callerGovernanceTokenAccount: getUserTokenRecordRealmsPDA(
        realm,
        governanceMint,
        callerKeypair.publicKey
      ),
      user: extraUser,
      userGovernanceTokenAccount: getUserTokenRecordRealmsPDA(
        realm,
        governanceMint,
        extraUser
      ),
    })
    .remainingAccounts(
      await buildRemainingAccountsForAccruesRewards(
        connection,
        callerKeypair,
        realm,
        rewardTokens,
        extraUser
      )
    )
    .instruction();

  await pSendAndConfirmTxn(
    rewardsProgram,
    [...getComputeLimitInstruction(400_000), accrueRewards],
    [],
    {
      skipPreflight: SKIP_PREFLIGHT,
    }
  );
}

export async function claimRewards(
  connection: Connection,
  userKeypair: Keypair,
  realm: PublicKey,
  rewardTokens: PublicKey[],
  governanceMint: PublicKey
) {
  const rewardsProgram = getRewardsProgram(connection, userKeypair);

  const claimRewards = await rewardsProgram.methods
    .claimRewards()
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      user: userKeypair.publicKey,
      realm,
      rewardTokens: getRewardTokensPDA(realm),
      governanceTokenMint: governanceMint,
      governanceStakedTokenAccount: getGovernanceHoldingPDA(
        realm,
        governanceMint
      ),
      callerGovernanceTokenAccount: getUserTokenRecordRealmsPDA(
        realm,
        governanceMint,
        userKeypair.publicKey
      ),
    })
    .remainingAccounts(
      await buildRemainingAccountsForClaimRewards(
        connection,
        userKeypair,
        realm,
        rewardTokens
      )
    )
    .instruction();

  await pSendAndConfirmTxn(rewardsProgram, [claimRewards], [], {
    skipPreflight: SKIP_PREFLIGHT,
  });
}
