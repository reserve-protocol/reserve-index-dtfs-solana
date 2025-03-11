import { airdrop, getConnectors, wait } from "../utils/program-helper";
import { BN, Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  accrueRewards,
  addRewardToken,
  claimRewards,
  initOrSetRewardRatio,
  removeRewardToken,
  setRewardsAdmin,
} from "../utils/rewards-helper";
import * as assert from "assert";

import {
  getRewardInfoPDA,
  getRewardTokensPDA,
  getUserRewardInfoPDA,
} from "../utils/pda-helper";
import {
  MAX_AUCTION_LENGTH,
  MAX_TVL_FEE,
  MAX_AUCTION_DELAY,
  MAX_MINT_FEE,
  MAX_FEE_FLOOR,
  DEFAULT_DECIMALS,
  FEE_NUMERATOR,
} from "../utils/constants";
import { initToken, mintToken } from "../utils/token-helper";

import { setDaoFeeConfig } from "../utils/folio-admin-helper";
import { Rewards } from "../target/types/rewards";
import { initFolio } from "../utils/folio-helper";

/**
 * Tests for the Rewards program.
 * These tests are designed to test the functionality of the Rewards program from
 * initializing the rewards to adding reward tokens to the rewards.
 */

describe("Reward Tests", () => {
  let connection: Connection;
  let programRewards: Program<Rewards>;
  let keys: any;

  let payerKeypair: Keypair;
  let adminKeypair: Keypair;
  let userKeypair: Keypair;

  let folioOwnerKeypair: Keypair;
  let folioTokenMint: Keypair;

  // TODO Realm
  const realm: PublicKey = Keypair.generate().publicKey;

  // TODO Executor
  const executor: Keypair = Keypair.generate();

  // TODO Reward admin
  const rewardAdminKeypair: Keypair = Keypair.generate();

  // TODO Governance mint
  const governanceTokenMint: PublicKey = Keypair.generate().publicKey;

  const rewardTokenMints = [
    { mint: Keypair.generate(), decimals: DEFAULT_DECIMALS },
    { mint: Keypair.generate(), decimals: DEFAULT_DECIMALS },
    { mint: Keypair.generate(), decimals: DEFAULT_DECIMALS },
  ];

  const feeRecipient: PublicKey = Keypair.generate().publicKey;

  before(async () => {
    ({ connection, programRewards, keys } = await getConnectors());

    payerKeypair = Keypair.fromSecretKey(Uint8Array.from(keys.payer));
    adminKeypair = Keypair.fromSecretKey(Uint8Array.from(keys.admin));

    folioTokenMint = Keypair.generate();

    folioOwnerKeypair = Keypair.generate();
    userKeypair = Keypair.generate();

    // Governance related tests are skipped for now, tested via Bankrun
    // Inject fake accounts in Amman for governance
    // const userTokenRecordPda = getUserTokenRecordRealmsPDA(
    //   folioOwnerKeypair.publicKey,
    //   folioTokenMint.publicKey,
    //   userKeypair.publicKey
    // );

    // await createGovernanceAccounts(userTokenRecordPda, 1000);

    // await wait(10);

    await airdrop(connection, payerKeypair.publicKey, 1000);
    await airdrop(connection, adminKeypair.publicKey, 1000);
    await airdrop(connection, folioOwnerKeypair.publicKey, 1000);
    await airdrop(connection, userKeypair.publicKey, 1000);

    for (const rewardTokenMint of rewardTokenMints) {
      await initToken(connection, adminKeypair, rewardTokenMint.mint);
      await mintToken(
        connection,
        adminKeypair,
        rewardTokenMint.mint.publicKey,
        1_000,
        adminKeypair.publicKey
      );
    }

    // Set dao fee recipient
    await setDaoFeeConfig(
      connection,
      adminKeypair,
      feeRecipient,
      FEE_NUMERATOR,
      MAX_FEE_FLOOR
    );

    // Init folio
    await initFolio(
      connection,
      folioOwnerKeypair,
      folioTokenMint,
      MAX_TVL_FEE,
      MAX_MINT_FEE,
      MAX_AUCTION_DELAY,
      MAX_AUCTION_LENGTH,
      "Test Folio",
      "TFOL",
      "https://test.com",
      "mandate"
    );
  });

  /*
     Skipping because it's tedious to create a realm and go through the spl governance process
     (tested via bankrun instead)
     */
  it.skip("should allow realm to set rewards admin ", async () => {
    await setRewardsAdmin(connection, executor, rewardAdminKeypair, realm);

    const rewardTokens = await programRewards.account.rewardTokens.fetch(
      getRewardTokensPDA(realm)
    );

    assert.deepEqual(rewardTokens.rewardsAdmin, rewardAdminKeypair.publicKey);
    assert.deepEqual(rewardTokens.realm, realm);
    assert.notEqual(rewardTokens.bump, 0);
  });

  /*
     Skipping because it's tedious to create a realm and go through the spl governance process
     (tested via bankrun instead)
     */
  it.skip("should allow reward admin to add reward token", async () => {
    await addRewardToken(
      connection,
      executor,
      rewardAdminKeypair,
      realm,
      rewardTokenMints[0].mint.publicKey
    );

    const rewardTokens = await programRewards.account.rewardTokens.fetch(
      getRewardTokensPDA(realm)
    );

    assert.equal(
      rewardTokens.rewardTokens[0].toBase58(),
      rewardTokenMints[0].mint.publicKey.toBase58()
    );
    assert.equal(rewardTokens.rewardRatio.eq(new BN(8022536812036)), true);
    assert.deepEqual(rewardTokens.realm, realm);
    assert.notEqual(rewardTokens.bump, 0);
  });

  /*
     Skipping because it's tedious to create a realm and go through the spl governance process
     (tested via bankrun instead)
     */
  it.skip("should allow reward admin to init or set reward ratio", async () => {
    await initOrSetRewardRatio(
      connection,
      executor,
      rewardAdminKeypair,
      realm,
      new BN(86400),
      governanceTokenMint
    );

    const rewardTokens = await programRewards.account.rewardTokens.fetch(
      getRewardTokensPDA(realm)
    );

    assert.equal(rewardTokens.rewardRatio.eq(new BN(8022536812036)), true);
  });

  /*
     Skipping because it's tedious to create a realm and go through the spl governance process
     (tested via bankrun instead)
     */
  it.skip("should allow reward admin to remove reward token", async () => {
    await removeRewardToken(
      connection,
      executor,
      rewardAdminKeypair,
      realm,
      rewardTokenMints[0].mint.publicKey
    );

    const rewardInfoPDA = getRewardInfoPDA(
      realm,
      rewardTokenMints[0].mint.publicKey
    );
    const rewardInfo = await programRewards.account.rewardInfo.fetch(
      rewardInfoPDA
    );

    assert.equal(rewardInfo.isDisallowed, true);

    const rewardTokens = await programRewards.account.rewardTokens.fetch(
      getRewardTokensPDA(realm)
    );

    assert.deepEqual(rewardTokens.rewardTokens[0], PublicKey.default);
  });

  /*
     Skipping because it's tedious to create a realm and go through the spl governance process 
     (tested via bankrun instead)
     */
  it.skip("should allow user to accrue rewards, after adding 1 more reward tokens", async () => {
    // Adding the tokens
    await addRewardToken(
      connection,
      executor,
      rewardAdminKeypair,
      realm,
      rewardTokenMints[1].mint.publicKey
    );

    const rewardTokenPDA = getRewardTokensPDA(realm);

    const rewardInfoPDA = getRewardInfoPDA(
      realm,
      rewardTokenMints[1].mint.publicKey
    );
    const rewardInfoBefore = await programRewards.account.rewardInfo.fetch(
      rewardInfoPDA
    );

    // Mint some token to the folio (as if received fees)
    // To generate rewards we'll mint a LOT of reward tokens, so that we don't have to wait for them to accrue to claim them
    for (let i = 0; i < 10; i++) {
      await mintToken(
        connection,
        adminKeypair,
        rewardTokenMints[1].mint.publicKey,
        1_000_000_000,
        rewardTokenPDA
      );
    }

    // First accrue rewards will be 0 since the balance unaccounted for is 0, so we'll call it twice
    // Calling accrue rewards
    await accrueRewards(
      connection,
      userKeypair,
      realm,
      [rewardTokenMints[1].mint.publicKey],
      governanceTokenMint,
      userKeypair.publicKey
    );

    const rewardInfoAfterFirstCall =
      await programRewards.account.rewardInfo.fetch(rewardInfoPDA);

    assert.equal(
      rewardInfoAfterFirstCall.balanceLastKnown.gt(
        rewardInfoBefore.balanceLastKnown
      ),
      true
    );

    // To generate a bit of rewards
    await wait(40);

    // Second call will accrue rewards
    await accrueRewards(
      connection,
      userKeypair,
      realm,
      [rewardTokenMints[1].mint.publicKey],
      governanceTokenMint,
      userKeypair.publicKey
    );

    const rewardInfoAfterSecondCall =
      await programRewards.account.rewardInfo.fetch(rewardInfoPDA);

    const userInfoRewardPDA = getUserRewardInfoPDA(
      realm,
      rewardTokenMints[1].mint.publicKey,
      userKeypair.publicKey
    );

    const userInfoRewardAfter =
      await programRewards.account.userRewardInfo.fetch(userInfoRewardPDA);

    assert.equal(
      rewardInfoAfterSecondCall.rewardIndex.gt(rewardInfoBefore.rewardIndex),
      true
    );

    assert.equal(
      rewardInfoAfterSecondCall.balanceAccounted.gt(
        rewardInfoBefore.balanceAccounted
      ),
      true
    );
    assert.equal(
      rewardInfoAfterSecondCall.payoutLastPaid.gt(
        rewardInfoBefore.payoutLastPaid
      ),
      true
    );

    assert.equal(userInfoRewardAfter.realm.toBase58(), realm.toBase58());
    assert.equal(
      userInfoRewardAfter.rewardToken.toBase58(),
      rewardTokenMints[1].mint.publicKey.toBase58()
    );
    assert.notEqual(userInfoRewardAfter.bump, 0);
    assert.equal(userInfoRewardAfter.accruedRewards.gte(new BN(0)), true);
    assert.equal(
      userInfoRewardAfter.lastRewardIndex.eq(
        rewardInfoAfterSecondCall.rewardIndex
      ),
      true
    );
  });

  /*
     Skipping because it's tedious to create a realm and go through the spl governance process 
     (tested via bankrun instead)
     */
  it.skip("should allow user to claim rewards", async () => {
    const rewardInfoPDA = getRewardInfoPDA(
      realm,
      rewardTokenMints[1].mint.publicKey
    );
    const userRewardInfoPDA = getUserRewardInfoPDA(
      realm,
      rewardTokenMints[1].mint.publicKey,
      userKeypair.publicKey
    );
    const rewardInfoBefore = await programRewards.account.rewardInfo.fetch(
      rewardInfoPDA
    );

    await claimRewards(
      connection,
      userKeypair,
      realm,
      [rewardTokenMints[1].mint.publicKey],
      governanceTokenMint
    );

    const rewardInfoAfter = await programRewards.account.rewardInfo.fetch(
      rewardInfoPDA
    );
    const userRewardInfoAfter =
      await programRewards.account.userRewardInfo.fetch(userRewardInfoPDA);

    assert.equal(
      rewardInfoAfter.totalClaimed.gt(rewardInfoBefore.totalClaimed),
      true
    );
    assert.equal(userRewardInfoAfter.accruedRewards.eq(new BN(0)), true);
  });
});
