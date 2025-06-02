import { BN, Program } from "@coral-xyz/anchor";
import { BankrunProvider } from "anchor-bankrun";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  BanksClient,
  BanksTransactionResultWithMeta,
  Clock,
  ProgramTestContext,
} from "solana-bankrun";

import {
  createAndSetActor,
  createAndSetFolio,
  createAndSetDaoFeeConfig,
  createAndSetRewardTokens,
  RewardInfo,
  UserRewardInfo,
  createAndSetRewardInfo,
  createAndSetUserRewardInfo,
  closeAccount,
  Role,
} from "../bankrun-account-helper";
import { Folio } from "../../../target/types/folio";
import {
  D18,
  D9,
  DEFAULT_DECIMALS,
  DEFAULT_DECIMALS_MUL,
  MAX_MINT_FEE,
  MAX_REWARD_TOKENS,
} from "../../../utils/constants";
import {
  getOrCreateAtaAddress,
  initToken,
  mintToken,
  resetTokenBalance,
} from "../bankrun-token-helper";
import { airdrop, assertError, getConnectors } from "../bankrun-program-helper";
import { travelFutureSlot } from "../bankrun-program-helper";
import {
  getFolioPDA,
  getGovernanceHoldingPDA,
  getRewardInfoPDA,
  getRewardTokensPDA,
  getUserRewardInfoPDA,
} from "../../../utils/pda-helper";

import * as assert from "assert";
import { FolioAdmin } from "../../../target/types/folio_admin";
import {
  depositLiquidityToGovernance,
  withdrawLiquidityFromGovernance,
} from "../bankrun-ix-helper";
import {
  createGovernanceHoldingAccount,
  setupGovernanceAccounts,
} from "../bankrun-governance-helper";
import { Rewards } from "../../../target/types/rewards";

/**
 * This  file is specifically for the case where the governance program will call
 * the accrue rewards instruction.
 *
 * This is different from the case where the user stakes their governance tokens
 * and the REWARDS program is called directly to accrue rewards.
 */
describe("Bankrun - Governance Staking User", () => {
  let context: ProgramTestContext;
  let provider: BankrunProvider;
  let banksClient: BanksClient;

  let programFolioAdmin: Program<FolioAdmin>;
  let programFolio: Program<Folio>;
  let programRewards: Program<Rewards>;

  let keys: any;

  let payerKeypair: Keypair;
  let adminKeypair: Keypair;

  let realmPDA: PublicKey;
  let folioOwnerPDA: PublicKey;
  let folioTokenMint: Keypair;
  let folioPDA: PublicKey;
  let rewardsAdminPDA: PublicKey;

  const rewardedUser1: Keypair = Keypair.generate();

  // To deposit from and withdraw to
  let userGoverningMintATA: PublicKey;

  const GOVERNANCE_MINT = Keypair.generate();

  const REWARD_TOKEN_MINTS = Array.from({ length: MAX_REWARD_TOKENS }, () =>
    Keypair.generate()
  );

  const DEFAULT_PARAMS: {
    rewardTokenBalances: {
      [key: string]: BN;
    };
    rewardInfosAlreadyThere: () => Promise<RewardInfo[]>;
    userRewardInfosAlreadyThere: UserRewardInfo[];

    timeToAddToClock: BN;

    rewardsTokenToClaim: PublicKey[];

    expectedRewardIndex: BN[];
    expectedBalanceAccountedChanges: BN[];
    expectedAccruedRewardsChanges: BN[];
  } = {
    rewardTokenBalances: {},
    rewardInfosAlreadyThere: async () => [],
    userRewardInfosAlreadyThere: [],

    timeToAddToClock: new BN(0),

    rewardsTokenToClaim: [],

    expectedRewardIndex: [],
    expectedBalanceAccountedChanges: [],
    expectedAccruedRewardsChanges: [],
  };

  const TEST_ACCRUE_REWARDS_VIA_GOVERNANCE = [
    {
      desc: "(accrue for user and 4 rewards, 86,400 seconds (1d) later, succeeds)",
      expectedError: null,
      rewardInfosAlreadyThere: async () => [
        await RewardInfo.default(context, REWARD_TOKEN_MINTS[0].publicKey),
        await RewardInfo.default(context, REWARD_TOKEN_MINTS[1].publicKey),
        await RewardInfo.default(context, REWARD_TOKEN_MINTS[2].publicKey),
        await RewardInfo.default(context, REWARD_TOKEN_MINTS[3].publicKey),
      ],
      rewardTokenBalances: {
        [REWARD_TOKEN_MINTS[0].publicKey.toBase58()]: new BN(100),
        [REWARD_TOKEN_MINTS[1].publicKey.toBase58()]: new BN(1000),
        [REWARD_TOKEN_MINTS[2].publicKey.toBase58()]: new BN(10000),
        [REWARD_TOKEN_MINTS[3].publicKey.toBase58()]: new BN(100000),
      },
      rewardsTokenToClaim: REWARD_TOKEN_MINTS.map((mint) => mint.publicKey),
      timeToAddToClock: new BN(86400),
      expectedBalanceAccountedChanges: [
        new BN("50000139020524853101"),
        new BN("500001390205248531001"),
        new BN("5000013902052485310001"),
        new BN("50000139020524853100001"),
      ],
      expectedRewardIndex: [
        new BN("250000693852620797"),
        new BN("2500006938526207963"),
        new BN("25000069385262079624"),
        new BN("250000693852620796237"),
      ],
      expectedAccruedRewardsChanges: [
        new BN("250000693852"), // First token
        new BN("2500006938526"), // Second token
        new BN("25000069385262"), // Third token
        new BN("250000693852620"), // Fourth token
      ],
    },
  ];

  async function getRewardsInfoAndUserRewardInfos(
    rewardsTokenToClaim: PublicKey[]
  ): Promise<{
    rewardInfos: RewardInfo[];
    userRewardInfos: UserRewardInfo[];
  }> {
    const rewardInfos: RewardInfo[] = [];
    const userRewardInfos: UserRewardInfo[] = [];

    for (const rewardToken of rewardsTokenToClaim) {
      const rewardInfoPDA = getRewardInfoPDA(realmPDA, rewardToken);

      const rewardInfo = await programRewards.account.rewardInfo.fetch(
        rewardInfoPDA
      );

      rewardInfos.push(
        new RewardInfo(
          rewardInfo.rewardToken,
          rewardInfo.payoutLastPaid,
          rewardInfo.rewardIndex,
          rewardInfo.balanceAccounted,
          rewardInfo.balanceLastKnown,
          rewardInfo.totalClaimed,
          rewardInfo.isDisallowed
        )
      );

      const userToUse = [rewardedUser1.publicKey];

      for (const userToClaimFor of userToUse) {
        const userRewardInfoPDA = getUserRewardInfoPDA(
          realmPDA,
          rewardToken,
          userToClaimFor
        );

        if (!(await banksClient.getAccount(userRewardInfoPDA))) {
          continue;
        }

        const userRewardInfo =
          await programRewards.account.userRewardInfo.fetch(userRewardInfoPDA);

        userRewardInfos.push(
          new UserRewardInfo(
            userRewardInfo.rewardToken,
            userToClaimFor,
            userRewardInfo.lastRewardIndex,
            userRewardInfo.accruedRewards
          )
        );
      }
    }

    return { rewardInfos, userRewardInfos };
  }

  async function initBaseCase(
    initialRewardTokenBalances: {
      [key: string]: BN;
    } = {},
    rewardInfos: RewardInfo[] = [],
    userRewardInfos: UserRewardInfo[] = [],
    // LN2 / min reward ratio available (so LN 2 / 1 day)
    rewardRatio: BN = new BN(8_022_536_812_037)
  ) {
    ({ folioOwnerPDA, realmPDA, rewardsAdminPDA } =
      await setupGovernanceAccounts(
        context,
        adminKeypair,
        GOVERNANCE_MINT.publicKey
      ));

    await createAndSetDaoFeeConfig(
      context,
      programFolioAdmin,
      new Keypair().publicKey,
      MAX_MINT_FEE
    );

    await createAndSetFolio(context, programFolio, folioTokenMint.publicKey);

    folioPDA = getFolioPDA(folioTokenMint.publicKey);

    initToken(
      context,
      folioPDA,
      folioTokenMint,
      DEFAULT_DECIMALS,
      new BN(1000000000)
    );

    await createAndSetActor(
      context,
      programFolio,
      folioOwnerPDA,
      folioPDA,
      Role.Owner
    );

    await createAndSetRewardTokens(
      context,
      programRewards,
      realmPDA,
      rewardsAdminPDA,
      rewardRatio,
      REWARD_TOKEN_MINTS.map((mint) => mint.publicKey)
    );

    const rewardTokensPDA = getRewardTokensPDA(realmPDA);

    // Init the reward tokens
    for (const rewardTokenMint of REWARD_TOKEN_MINTS) {
      let supply = new BN(0);

      // Mint token to the PDA for rewards
      if (initialRewardTokenBalances[rewardTokenMint.publicKey.toBase58()]) {
        supply = initialRewardTokenBalances[
          rewardTokenMint.publicKey.toBase58()
        ].mul(new BN(DEFAULT_DECIMALS_MUL));

        mintToken(
          context,
          rewardTokenMint.publicKey,
          initialRewardTokenBalances[
            rewardTokenMint.publicKey.toBase58()
          ].toNumber(),
          rewardTokensPDA
        );
      }

      initToken(context, realmPDA, rewardTokenMint, DEFAULT_DECIMALS, supply);

      await resetTokenBalance(
        context,
        rewardTokenMint.publicKey,
        rewardedUser1.publicKey
      );
    }

    // Reset reward info accounts
    for (const rewardToken of REWARD_TOKEN_MINTS) {
      closeAccount(context, getRewardInfoPDA(realmPDA, rewardToken.publicKey));
    }

    // Init reward info if provided
    for (const rewardInfo of rewardInfos) {
      await createAndSetRewardInfo(
        context,
        programRewards,
        realmPDA,
        rewardInfo
      );
    }

    // Reset user reward info account
    for (const rewardToken of REWARD_TOKEN_MINTS) {
      for (const user of [rewardedUser1.publicKey]) {
        closeAccount(
          context,
          getUserRewardInfoPDA(realmPDA, rewardToken.publicKey, user)
        );
      }
    }

    // Init reward user info if provided (
    for (const userRewardInfo of userRewardInfos) {
      await createAndSetUserRewardInfo(
        context,
        programRewards,
        realmPDA,
        userRewardInfo
      );
    }

    // Init governance holding token account and mint
    initToken(
      context,
      // We don't care about who owns it
      realmPDA,
      GOVERNANCE_MINT.publicKey,
      DEFAULT_DECIMALS,
      new BN(0)
    );

    createGovernanceHoldingAccount(
      context,
      realmPDA,
      GOVERNANCE_MINT.publicKey,
      getGovernanceHoldingPDA(realmPDA, GOVERNANCE_MINT.publicKey),
      // As if there's already 200 staked by some other user
      new BN(200).mul(D9)
    );

    userGoverningMintATA = await getOrCreateAtaAddress(
      context,
      GOVERNANCE_MINT.publicKey,
      rewardedUser1.publicKey
    );

    mintToken(
      context,
      GOVERNANCE_MINT.publicKey,
      10000,
      rewardedUser1.publicKey
    );
  }

  before(async () => {
    ({
      keys,
      programFolioAdmin,
      programRewards,
      programFolio,
      provider,
      context,
    } = await getConnectors());

    banksClient = context.banksClient;

    payerKeypair = provider.wallet.payer;

    adminKeypair = Keypair.fromSecretKey(Uint8Array.from(keys.admin));
    folioTokenMint = Keypair.generate();

    await airdrop(context, payerKeypair.publicKey, 1000);
    await airdrop(context, adminKeypair.publicKey, 1000);
    await airdrop(context, rewardedUser1.publicKey, 1000);

    folioPDA = getFolioPDA(folioTokenMint.publicKey);

    await initBaseCase();
  });

  describe.only("Specific Cases - Accrue Rewards via Governance", () => {
    TEST_ACCRUE_REWARDS_VIA_GOVERNANCE.forEach(
      ({ desc, expectedError, ...restOfParams }) => {
        describe(`When ${desc}`, () => {
          let txnResult: BanksTransactionResultWithMeta;

          const {
            rewardInfosAlreadyThere,
            userRewardInfosAlreadyThere,
            rewardTokenBalances,
            rewardsTokenToClaim,
            timeToAddToClock,
            expectedBalanceAccountedChanges,
            expectedRewardIndex,
            expectedAccruedRewardsChanges,
          } = {
            ...DEFAULT_PARAMS,
            ...restOfParams,
          };

          let currentClock: Clock;

          let rewardInfosBefore: RewardInfo[];
          let userRewardInfosBefore: UserRewardInfo[];

          before(async () => {
            const rewardInfosAlreadyThereToUse =
              await rewardInfosAlreadyThere();

            await initBaseCase(
              rewardTokenBalances,
              rewardInfosAlreadyThereToUse,
              userRewardInfosAlreadyThere
            );

            currentClock = await context.banksClient.getClock();

            await createAndSetFolio(
              context,
              programFolio,
              folioTokenMint.publicKey
            );

            await travelFutureSlot(context);

            // Save before values, for our later assertions (only if no error, else useless)
            if (!expectedError) {
              ({
                rewardInfos: rewardInfosBefore,
                userRewardInfos: userRewardInfosBefore,
              } = await getRewardsInfoAndUserRewardInfos(rewardsTokenToClaim));
            }

            context.setClock(
              new Clock(
                currentClock.slot,
                currentClock.epochStartTimestamp,
                currentClock.epoch,
                currentClock.leaderScheduleEpoch,
                currentClock.unixTimestamp + BigInt(timeToAddToClock.toNumber())
              )
            );

            // First deposit some liquidity to the governance
            txnResult = await depositLiquidityToGovernance(
              context,
              programRewards,
              rewardedUser1,
              realmPDA,
              GOVERNANCE_MINT.publicKey,
              userGoverningMintATA,
              rewardsTokenToClaim,
              new BN(1000)
            );

            await travelFutureSlot(context);

            // Travel later, so some rewards are accrued
            context.setClock(
              new Clock(
                currentClock.slot,
                currentClock.epochStartTimestamp,
                currentClock.epoch,
                currentClock.leaderScheduleEpoch,
                currentClock.unixTimestamp +
                  BigInt(timeToAddToClock.toNumber() * 2)
              )
            );

            // Withdraw liquidity from the governance, which should trigger accrue rewards
            txnResult = await withdrawLiquidityFromGovernance(
              context,
              programRewards,
              rewardedUser1,
              realmPDA,
              GOVERNANCE_MINT.publicKey,
              userGoverningMintATA,
              rewardsTokenToClaim
            );
          });

          if (expectedError) {
            it("should fail with expected error", () => {
              assertError(txnResult, expectedError);
            });
          } else {
            it("should succeed", async () => {
              await travelFutureSlot(context);

              const { rewardInfos, userRewardInfos } =
                await getRewardsInfoAndUserRewardInfos(rewardsTokenToClaim);

              for (let i = 0; i < rewardInfos.length; i++) {
                const initialRewardTokenBalanceOfRealm = (
                  rewardTokenBalances[rewardInfos[i].rewardToken.toBase58()] ??
                  new BN(0)
                ).mul(D18);

                assert.equal(
                  rewardInfos[i].balanceLastKnown.eq(
                    rewardInfosBefore[i].balanceLastKnown.add(
                      initialRewardTokenBalanceOfRealm
                    )
                  ),
                  true
                );

                assert.equal(
                  rewardInfos[i].totalClaimed.eq(
                    rewardInfosBefore[i].totalClaimed
                  ),
                  true
                );

                assert.equal(
                  rewardInfos[i].payoutLastPaid.eq(
                    rewardInfosBefore[i].payoutLastPaid.add(
                      new BN(timeToAddToClock.mul(new BN(2)))
                    )
                  ),
                  true
                );

                const expectedBalanceAccounted =
                  expectedBalanceAccountedChanges.length > i
                    ? expectedBalanceAccountedChanges[i]
                    : new BN(0);

                assert.equal(
                  rewardInfos[i].balanceAccounted.eq(
                    rewardInfosBefore[i].balanceAccounted.add(
                      expectedBalanceAccounted
                    )
                  ),
                  true
                );

                const expectedRewardIndexToUse =
                  expectedRewardIndex.length > i
                    ? expectedRewardIndex[i]
                    : new BN(0);

                assert.equal(
                  rewardInfos[i].rewardIndex.eq(
                    rewardInfosBefore[i].rewardIndex.add(
                      expectedRewardIndexToUse
                    )
                  ),
                  true
                );
              }

              for (let i = 0; i < userRewardInfos.length; i++) {
                let accruedRewardsBefore = new BN(0);
                let lastRewardIndexBefore = new BN(0);

                if (i < userRewardInfosBefore.length) {
                  accruedRewardsBefore =
                    userRewardInfosBefore[i].accruedRewards;
                  lastRewardIndexBefore =
                    userRewardInfosBefore[i].lastRewardIndex;
                }

                const expectedAccrueRewards =
                  expectedAccruedRewardsChanges.length > i
                    ? expectedAccruedRewardsChanges[i]
                    : new BN(0);

                assert.equal(
                  userRewardInfos[i].accruedRewards.eq(
                    accruedRewardsBefore.add(expectedAccrueRewards)
                  ),
                  true
                );

                const expectedRewardIndexToUse =
                  expectedRewardIndex.length > i
                    ? expectedRewardIndex[i]
                    : new BN(0);

                assert.equal(
                  userRewardInfos[i].lastRewardIndex.eq(
                    lastRewardIndexBefore.add(expectedRewardIndexToUse)
                  ),
                  true
                );
              }
            });
          }
        });
      }
    );
  });
});
