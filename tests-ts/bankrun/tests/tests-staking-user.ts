import { BN, Program } from "@coral-xyz/anchor";
import { BankrunProvider } from "anchor-bankrun";
import { AccountMeta, Keypair, PublicKey } from "@solana/web3.js";
import {
  BanksClient,
  BanksTransactionResultWithMeta,
  Clock,
  ProgramTestContext,
} from "solana-bankrun";

import {
  createAndSetActor,
  createAndSetFolio,
  FolioStatus,
  createAndSetDaoFeeConfig,
  createAndSetFolioRewardTokens,
  RewardInfo,
  UserRewardInfo,
  createAndSetRewardInfo,
  createAndSetUserRewardInfo,
  buildRemainingAccountsForClaimRewards,
  buildRemainingAccountsForAccruesRewards,
  closeAccount,
} from "../bankrun-account-helper";
import { Folio } from "../../../target/types/folio";
import {
  D18,
  D9,
  DEFAULT_DECIMALS,
  DEFAULT_DECIMALS_MUL,
  MAX_MINT_FEE,
} from "../../../utils/constants";
import {
  assertExpectedBalancesChanges,
  getOrCreateAtaAddress,
  getTokenBalancesFromMints,
  initToken,
  mintToken,
  resetTokenBalance,
} from "../bankrun-token-helper";
import { Role } from "../bankrun-account-helper";
import { airdrop, assertError, getConnectors } from "../bankrun-program-helper";
import { travelFutureSlot } from "../bankrun-program-helper";
import {
  getFolioPDA,
  getFolioRewardTokensPDA,
  getGovernanceHoldingPDA,
  getRewardInfoPDA,
  getUserRewardInfoPDA,
  getUserTokenRecordRealmsPDA,
} from "../../../utils/pda-helper";
import { accrueRewards, claimRewards } from "../bankrun-ix-helper";
import {
  assertInvalidFolioStatusTestCase,
  GeneralTestCases,
} from "../bankrun-general-tests-helper";
import * as assert from "assert";
import { FolioAdmin } from "../../../target/types/folio_admin";
import {
  createGovernanceHoldingAccount,
  createGovernanceTokenRecord,
  setupGovernanceAccounts,
} from "../bankrun-governance-helper";

describe("Bankrun - Staking User", () => {
  let context: ProgramTestContext;
  let provider: BankrunProvider;
  let banksClient: BanksClient;

  let programFolioAdmin: Program<FolioAdmin>;
  let programFolio: Program<Folio>;

  let keys: any;

  let payerKeypair: Keypair;
  let adminKeypair: Keypair;

  let realmPDA: PublicKey;
  let folioOwnerPDA: PublicKey;

  let folioTokenMint: Keypair;
  let folioPDA: PublicKey;

  const rewardedUser1: Keypair = Keypair.generate();
  const rewardedUser2: Keypair = Keypair.generate();

  const GOVERNANCE_MINT = Keypair.generate();

  const REWARD_TOKEN_MINTS = [Keypair.generate(), Keypair.generate()];

  const INDEX_FOR_REMAINING_ACCOUNTS = {
    REWARD_TOKEN: 0,
    REWARD_INFO: 1,
    REWARD_TOKEN_ATA: 2,
    USER_REWARD_INFO: 3,
    EXTRA_USER_REWARD_INFO: 4,
  };

  const DEFAULT_PARAMS: {
    customFolioTokenMint: Keypair | null;
    customRole: Role;

    remainingAccounts: () => AccountMeta[];

    folioRewardTokenBalances: {
      [key: string]: BN;
    };
    rewardInfosAlreadyThere: () => Promise<RewardInfo[]>;
    userRewardInfosAlreadyThere: UserRewardInfo[];
    userStakedBalances: {
      [key: string]: BN;
    };

    indexAccountToInvalidate: number | null;

    // This is because the first time ever we run accrue rewards, it has 0 rewards
    // so we'll run it twice to make sure we get the rewards for our asserts
    runTwice: boolean;

    timeToAddToClock: BN;

    rewardRatio: BN;

    rewardsTokenToClaim: PublicKey[];
    extraUserToClaimFor: PublicKey;

    governanceMint: PublicKey;
    governanceHoldingTokenAccount: PublicKey;

    callerGovernanceTokenAccount: () => PublicKey;
    userGovernanceTokenAccount: () => PublicKey;

    expectedRewardIndex: BN[];
    expectedBalanceAccountedChanges: BN[];
    expectedAccruedRewardsChanges: BN[];
    expectedRewardBalanceChanges: BN[];
  } = {
    customFolioTokenMint: null,
    customRole: Role.Owner,

    remainingAccounts: () => [],

    folioRewardTokenBalances: {},
    rewardInfosAlreadyThere: async () => [],
    userRewardInfosAlreadyThere: [],
    userStakedBalances: {},

    indexAccountToInvalidate: null,

    runTwice: false,

    timeToAddToClock: new BN(0),

    rewardRatio: new BN(8_022_536_812_037), // LN2 / min reward ratio available (so LN 2 / 1 day)

    rewardsTokenToClaim: [],
    extraUserToClaimFor: null,

    governanceMint: GOVERNANCE_MINT.publicKey,
    governanceHoldingTokenAccount: null,

    callerGovernanceTokenAccount: () => null,
    userGovernanceTokenAccount: () => null,

    expectedRewardIndex: [],
    expectedBalanceAccountedChanges: [],
    expectedAccruedRewardsChanges: [],
    expectedRewardBalanceChanges: [],
  };

  const TEST_ACCRUE_REWARDS = [
    {
      desc: "(passes the wrong folio owner as account [not as signer, just not the right one], errors out)",
      expectedError: "InvalidRole",
      customRole: Role.AuctionLauncher,
    },
    {
      desc: "(passes wrong governance holding token account, errors out)",
      expectedError: "InvalidHoldingTokenAccount",
      governanceHoldingTokenAccount: PublicKey.default,
    },
    {
      desc: "(passes wrong number of remaining accounts, errors out)",
      expectedError: "InvalidNumberOfRemainingAccounts",
      remainingAccounts: () => [
        {
          pubkey: PublicKey.default,
          isWritable: false,
          isSigner: false,
        },
      ],
    },
    {
      desc: "(passes wrong pda for reward info, errors out)",
      expectedError: "InvalidRewardInfo",
      rewardsTokenToClaim: [REWARD_TOKEN_MINTS[0].publicKey],
      indexAccountToInvalidate: INDEX_FOR_REMAINING_ACCOUNTS.REWARD_INFO,
    },
    {
      desc: "(passes wrong pda for caller's reward info, errors out)",
      expectedError: "InvalidUserRewardInfo",
      rewardsTokenToClaim: [REWARD_TOKEN_MINTS[0].publicKey],
      indexAccountToInvalidate: INDEX_FOR_REMAINING_ACCOUNTS.USER_REWARD_INFO,
    },
    {
      desc: "(passes wrong fee recipient token account, eerrors out)",
      expectedError: "InvalidFeeRecipientTokenAccount",
      rewardsTokenToClaim: [REWARD_TOKEN_MINTS[0].publicKey],
      indexAccountToInvalidate: INDEX_FOR_REMAINING_ACCOUNTS.REWARD_TOKEN_ATA,
    },
    {
      desc: "(passes wrong pda for caller's governance account, errors out)",
      expectedError: "InvalidGovernanceAccount",
      rewardInfosAlreadyThere: async () => [
        await RewardInfo.default(context, REWARD_TOKEN_MINTS[0].publicKey),
      ],
      rewardsTokenToClaim: [REWARD_TOKEN_MINTS[0].publicKey],
      callerGovernanceTokenAccount: () => getInvalidGovernanceAccount(),
    },
    {
      desc: "(accrue rewards: current time is = last payout time, does nothing)",
      expectedError: null,
      rewardInfosAlreadyThere: async () => [
        await RewardInfo.default(context, REWARD_TOKEN_MINTS[0].publicKey),
      ],
      userStakedBalances: {
        [rewardedUser1.publicKey.toBase58()]: new BN(100),
      },
      rewardsTokenToClaim: [REWARD_TOKEN_MINTS[0].publicKey],
    },
    {
      desc: "(accrue rewards: current reward token balance is 0, does not accrue rewards but updates last payout time)",
      expectedError: null,
      rewardInfosAlreadyThere: async () => [
        await RewardInfo.default(context, REWARD_TOKEN_MINTS[0].publicKey),
      ],
      userStakedBalances: {
        [rewardedUser1.publicKey.toBase58()]: new BN(100),
      },
      rewardsTokenToClaim: [REWARD_TOKEN_MINTS[0].publicKey],
      timeToAddToClock: new BN(10),
    },
    {
      desc: "(accrue user (caller) rewards: delta result = 0, does nothing)",
      expectedError: null,
      rewardInfosAlreadyThere: async () => [
        await RewardInfo.default(context, REWARD_TOKEN_MINTS[0].publicKey),
      ],
      userStakedBalances: {
        [rewardedUser1.publicKey.toBase58()]: new BN(100),
      },
      rewardsTokenToClaim: [REWARD_TOKEN_MINTS[0].publicKey],
      timeToAddToClock: new BN(10),
      folioRewardTokenBalances: {
        [REWARD_TOKEN_MINTS[0].publicKey.toBase58()]: new BN(100),
      },
    },
    // Not for the user (if pass extra user account)
    {
      desc: "(passes wrong pda for user's reward info, errors out)",
      expectedError: "InvalidUserRewardInfo",
      rewardInfosAlreadyThere: async () => [
        await RewardInfo.default(context, REWARD_TOKEN_MINTS[0].publicKey),
      ],
      rewardsTokenToClaim: [REWARD_TOKEN_MINTS[0].publicKey],
      indexAccountToInvalidate:
        INDEX_FOR_REMAINING_ACCOUNTS.EXTRA_USER_REWARD_INFO,
      extraUserToClaimFor: rewardedUser2.publicKey,
    },
    {
      desc: "(passes wrong pda for user's governance account, errors out)",
      expectedError: "InvalidGovernanceAccount",
      rewardInfosAlreadyThere: async () => [
        await RewardInfo.default(context, REWARD_TOKEN_MINTS[0].publicKey),
      ],
      rewardsTokenToClaim: [REWARD_TOKEN_MINTS[0].publicKey],
      userGovernanceTokenAccount: () => getInvalidGovernanceAccount(),
      extraUserToClaimFor: rewardedUser2.publicKey,
    },
    {
      desc: "(accrue for both users and rewards, succeeds)",
      expectedError: null,
      rewardInfosAlreadyThere: async () => [
        await RewardInfo.default(context, REWARD_TOKEN_MINTS[0].publicKey),
        await RewardInfo.default(context, REWARD_TOKEN_MINTS[1].publicKey),
      ],
      userStakedBalances: {
        [rewardedUser1.publicKey.toBase58()]: new BN(100).mul(D9),
        [rewardedUser2.publicKey.toBase58()]: new BN(200).mul(D9),
      },
      folioRewardTokenBalances: {
        [REWARD_TOKEN_MINTS[0].publicKey.toBase58()]: new BN(100), // is multipled by decimals in function
        [REWARD_TOKEN_MINTS[1].publicKey.toBase58()]: new BN(1000), // is multipled by decimals in function
      },
      rewardsTokenToClaim: [
        REWARD_TOKEN_MINTS[0].publicKey,
        REWARD_TOKEN_MINTS[1].publicKey,
      ],
      timeToAddToClock: new BN(10),
      extraUserToClaimFor: rewardedUser2.publicKey,
      runTwice: true,
      expectedBalanceAccountedChanges: [
        new BN("8022247193297401"), // ≈0.8% of 100 tokens
        new BN("80222471932974001"), // ≈0.8% of 1000 tokens
      ],
      expectedRewardIndex: [
        new BN("26740823977659"),
        new BN("267408239776581"),
      ],
      expectedAccruedRewardsChanges: [
        // First token
        new BN("2674082397765900"), // User1 (1/3 share)
        new BN("5348164795531800"), // User2 (2/3 share)
        // Second token
        new BN("26740823977658100"), // User1 (1/3 share)
        new BN("53481647955316200"), // User2 (2/3 share)
      ],
    },
    // Testing how long before we get a math overflow
    {
      desc: "(accrue for both users and rewards, 60 seconds later, succeeds)",
      expectedError: null,
      rewardInfosAlreadyThere: async () => [
        await RewardInfo.default(context, REWARD_TOKEN_MINTS[0].publicKey),
        await RewardInfo.default(context, REWARD_TOKEN_MINTS[1].publicKey),
      ],
      userStakedBalances: {
        [rewardedUser1.publicKey.toBase58()]: new BN(100).mul(D9),
        [rewardedUser2.publicKey.toBase58()]: new BN(200).mul(D9),
      },
      folioRewardTokenBalances: {
        [REWARD_TOKEN_MINTS[0].publicKey.toBase58()]: new BN(100),
        [REWARD_TOKEN_MINTS[1].publicKey.toBase58()]: new BN(1000),
      },
      rewardsTokenToClaim: [REWARD_TOKEN_MINTS[0].publicKey],
      timeToAddToClock: new BN(60),
      extraUserToClaimFor: rewardedUser2.publicKey,
      runTwice: true,
      expectedBalanceAccountedChanges: [new BN("48123830724785201")],
      expectedRewardIndex: [new BN("160412769082618")],
      expectedAccruedRewardsChanges: [
        new BN("16041276908261800"), // User1
        new BN("32082553816523600"), // User2
      ],
    },
    {
      desc: "(accrue for both users and rewards, 3,600 seconds (1h) later, succeeds)",
      expectedError: null,
      rewardInfosAlreadyThere: async () => [
        await RewardInfo.default(context, REWARD_TOKEN_MINTS[0].publicKey),
        await RewardInfo.default(context, REWARD_TOKEN_MINTS[1].publicKey),
      ],
      userStakedBalances: {
        [rewardedUser1.publicKey.toBase58()]: new BN(100).mul(D9),
        [rewardedUser2.publicKey.toBase58()]: new BN(200).mul(D9),
      },
      folioRewardTokenBalances: {
        [REWARD_TOKEN_MINTS[0].publicKey.toBase58()]: new BN(100),
        [REWARD_TOKEN_MINTS[1].publicKey.toBase58()]: new BN(1000),
      },
      rewardsTokenToClaim: [REWARD_TOKEN_MINTS[0].publicKey],
      timeToAddToClock: new BN(3600),
      extraUserToClaimFor: rewardedUser2.publicKey,
      runTwice: true,
      expectedBalanceAccountedChanges: [new BN("2846817139894439001")],
      expectedRewardIndex: [new BN("9489390466314797")],
      expectedAccruedRewardsChanges: [
        new BN("948939046631479700"), // User1
        new BN("1897878093262959400"), // User2
      ],
    },
    {
      desc: "(accrue for both users and rewards, 86,400 seconds (1d) later, succeeds)",
      expectedError: null,
      rewardInfosAlreadyThere: async () => [
        await RewardInfo.default(context, REWARD_TOKEN_MINTS[0].publicKey),
        await RewardInfo.default(context, REWARD_TOKEN_MINTS[1].publicKey),
      ],
      userStakedBalances: {
        [rewardedUser1.publicKey.toBase58()]: new BN(100).mul(D9),
        [rewardedUser2.publicKey.toBase58()]: new BN(200).mul(D9),
      },
      folioRewardTokenBalances: {
        [REWARD_TOKEN_MINTS[0].publicKey.toBase58()]: new BN(100),
        [REWARD_TOKEN_MINTS[1].publicKey.toBase58()]: new BN(1000),
      },
      rewardsTokenToClaim: [
        REWARD_TOKEN_MINTS[0].publicKey,
        REWARD_TOKEN_MINTS[1].publicKey,
      ],
      timeToAddToClock: new BN(86400),
      extraUserToClaimFor: rewardedUser2.publicKey,
      runTwice: true,
      expectedBalanceAccountedChanges: [
        new BN("50000139020524853101"),
        new BN("500001390205248531001"),
      ],
      expectedRewardIndex: [
        new BN("166667130068416178"),
        new BN("1666671300684161771"),
      ],
      expectedAccruedRewardsChanges: [
        // First token
        new BN("16666713006841617800"), // User1
        new BN("33333426013683235600"), // User2
        // Second token
        new BN("166667130068416177100"), // User1
        new BN("333334260136832354200"), // User2
      ],
    },
    // Taken from solidity code (to match results)
    {
      desc: "single reward token multiple even actors",
      expectedError: null,
      rewardInfosAlreadyThere: async () => [
        await RewardInfo.default(context, REWARD_TOKEN_MINTS[0].publicKey),
      ],
      userStakedBalances: {
        [rewardedUser1.publicKey.toBase58()]: new BN("500000000000"), // 500e9
        [rewardedUser2.publicKey.toBase58()]: new BN("500000000000"), // 500e9
      },
      folioRewardTokenBalances: {
        [REWARD_TOKEN_MINTS[0].publicKey.toBase58()]: new BN("1000"), // 1000 is multipled by decimals in function
      },
      rewardsTokenToClaim: [REWARD_TOKEN_MINTS[0].publicKey],
      timeToAddToClock: new BN(259200), // 3 days
      expectedBalanceAccountedChanges: [new BN("500000463400555594001")], //
      expectedRewardIndex: [
        new BN("500000463400555595"),
        new BN("500000463400555595"),
      ],
      expectedAccruedRewardsChanges: [
        new BN("250000231700277797500"),
        new BN("250000231700277797500"),
      ],
      runTwice: true,
      rewardRatio: new BN(2_674_178_937_345), // LN2 / 3 days
    },
  ];

  const TEST_CLAIM_REWARDS = [
    {
      desc: "(passes the wrong folio owner as account [not as signer, just not the right one], errors out)",
      expectedError: "InvalidRole",
      customRole: Role.AuctionLauncher,
    },
    {
      desc: "(passes wrong number of remaining accounts, errors out)",
      expectedError: "InvalidNumberOfRemainingAccounts",
      remainingAccounts: () => [
        {
          pubkey: PublicKey.default,
          isWritable: false,
          isSigner: false,
        },
      ],
    },
    {
      desc: "(passes wrong pda for reward info, errors out)",
      expectedError: "InvalidRewardInfo",
      rewardsTokenToClaim: [REWARD_TOKEN_MINTS[0].publicKey],
      indexAccountToInvalidate: INDEX_FOR_REMAINING_ACCOUNTS.REWARD_INFO,
    },
    {
      desc: "(passes wrong pda for user's reward info, errors out)",
      expectedError: "InvalidUserRewardInfo",
      rewardsTokenToClaim: [REWARD_TOKEN_MINTS[0].publicKey],
      indexAccountToInvalidate: INDEX_FOR_REMAINING_ACCOUNTS.USER_REWARD_INFO,
    },
    {
      desc: "(passes wrong fee recipient token account, errors out)",
      expectedError: "InvalidFeeRecipientTokenAccount",
      rewardsTokenToClaim: [REWARD_TOKEN_MINTS[0].publicKey],
      indexAccountToInvalidate: INDEX_FOR_REMAINING_ACCOUNTS.REWARD_TOKEN_ATA,
    },
    {
      desc: "(claimable rewards == 0, errors out)",
      expectedError: "NoRewardsToClaim",
      folioRewardTokenBalances: {
        [REWARD_TOKEN_MINTS[0].publicKey.toBase58()]: new BN(100),
      },
      rewardInfosAlreadyThere: async () => [
        await RewardInfo.default(context, REWARD_TOKEN_MINTS[0].publicKey),
      ],
      userRewardInfosAlreadyThere: [
        new UserRewardInfo(
          REWARD_TOKEN_MINTS[0].publicKey,
          rewardedUser1.publicKey,
          new BN(0),
          new BN(0)
        ),
      ],
      rewardsTokenToClaim: [REWARD_TOKEN_MINTS[0].publicKey],
      expectedRewardBalanceChanges: [new BN(0)],
    },
    {
      desc: "(claimable rewards != 0, claims rewards)",
      expectedError: null,
      folioRewardTokenBalances: {
        [REWARD_TOKEN_MINTS[0].publicKey.toBase58()]: new BN(100).mul(D9),
      },
      rewardInfosAlreadyThere: async () => [
        await RewardInfo.default(context, REWARD_TOKEN_MINTS[0].publicKey),
      ],
      userRewardInfosAlreadyThere: [
        new UserRewardInfo(
          REWARD_TOKEN_MINTS[0].publicKey,
          rewardedUser1.publicKey,
          new BN(1),
          // Is stored in D18 for increase precision
          new BN(5).mul(D18)
        ),
      ],
      rewardsTokenToClaim: [REWARD_TOKEN_MINTS[0].publicKey],
      expectedRewardBalanceChanges: [new BN(5).mul(D9)],
    },
  ];

  function getInvalidGovernanceAccount(): PublicKey {
    const invalidGovernanceAccount = getUserTokenRecordRealmsPDA(
      folioOwnerPDA,
      GOVERNANCE_MINT.publicKey,
      Keypair.generate().publicKey
    );

    createGovernanceTokenRecord(context, invalidGovernanceAccount, 0);

    return invalidGovernanceAccount;
  }

  async function buildRemainingAccountsAccrue(
    remainingAccounts: AccountMeta[],
    indexAccountToInvalidate: number
  ) {
    /*
    Order is token, reward info, reward token ata, user reward info,
    user governance, extra user reward info, extra user governance
    */

    // So will invalidate the account based on index
    if (
      indexAccountToInvalidate === INDEX_FOR_REMAINING_ACCOUNTS.REWARD_TOKEN_ATA
    ) {
      remainingAccounts[indexAccountToInvalidate].pubkey =
        await getOrCreateAtaAddress(
          context,
          REWARD_TOKEN_MINTS[0].publicKey,
          Keypair.generate().publicKey
        );
    } else {
      remainingAccounts[indexAccountToInvalidate].pubkey =
        Keypair.generate().publicKey;
    }

    return remainingAccounts;
  }

  async function getRewardsInfoAndUserRewardInfos(
    rewardsTokenToClaim: PublicKey[],
    extraUserToClaimFor: PublicKey
  ): Promise<{
    rewardInfos: RewardInfo[];
    userRewardInfos: UserRewardInfo[];
  }> {
    const rewardInfos: RewardInfo[] = [];
    const userRewardInfos: UserRewardInfo[] = [];

    for (const rewardToken of rewardsTokenToClaim) {
      const rewardInfoPDA = getRewardInfoPDA(folioPDA, rewardToken);

      const rewardInfo = await programFolio.account.rewardInfo.fetch(
        rewardInfoPDA
      );

      rewardInfos.push(
        new RewardInfo(
          rewardInfo.folioRewardToken,
          rewardInfo.payoutLastPaid,
          rewardInfo.rewardIndex,
          rewardInfo.balanceAccounted,
          rewardInfo.balanceLastKnown,
          rewardInfo.totalClaimed
        )
      );

      const userToUse = [rewardedUser1.publicKey];

      if (
        extraUserToClaimFor &&
        extraUserToClaimFor !== rewardedUser1.publicKey
      ) {
        userToUse.push(extraUserToClaimFor);
      }

      for (const userToClaimFor of userToUse) {
        const userRewardInfoPDA = getUserRewardInfoPDA(
          folioPDA,
          rewardToken,
          userToClaimFor
        );

        if (!(await banksClient.getAccount(userRewardInfoPDA))) {
          continue;
        }

        const userRewardInfo = await programFolio.account.userRewardInfo.fetch(
          userRewardInfoPDA
        );

        userRewardInfos.push(
          new UserRewardInfo(
            userRewardInfo.folioRewardToken,
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
    customFolioTokenMint: Keypair | null = null,
    customRole: Role = Role.Owner,
    customFolioTokenSupply: BN = new BN(0),
    initialRewardTokenBalances: {
      [key: string]: BN;
    } = {},
    rewardInfos: RewardInfo[] = [],
    userRewardInfos: UserRewardInfo[] = [],
    userStakedBalances: {
      [key: string]: BN;
    } = {},
    rewardRatio: BN = new BN(8_022_536_812_037) // LN2 / min reward ratio available (so LN 2 / 1 day)
  ) {
    ({ folioOwnerPDA, realmPDA } = await setupGovernanceAccounts(
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

    const folioTokenMintToUse = customFolioTokenMint || folioTokenMint;

    await createAndSetFolio(
      context,
      programFolio,
      folioTokenMintToUse.publicKey
    );

    folioPDA = getFolioPDA(folioTokenMintToUse.publicKey);

    initToken(
      context,
      folioPDA,
      folioTokenMintToUse,
      DEFAULT_DECIMALS,
      customFolioTokenSupply
    );

    await createAndSetActor(
      context,
      programFolio,
      folioOwnerPDA,
      folioPDA,
      customRole
    );

    await createAndSetFolioRewardTokens(
      context,
      programFolio,
      folioPDA,
      rewardRatio, // LN2 / min reward ratio available (so LN 2 / 1 day)
      REWARD_TOKEN_MINTS.map((mint) => mint.publicKey),
      []
    );

    const folioRewardTokensPDA = getFolioRewardTokensPDA(folioPDA);

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
          folioRewardTokensPDA
        );
      }

      initToken(context, folioPDA, rewardTokenMint, DEFAULT_DECIMALS, supply);

      await resetTokenBalance(
        context,
        rewardTokenMint.publicKey,
        rewardedUser1.publicKey
      );

      await resetTokenBalance(
        context,
        rewardTokenMint.publicKey,
        rewardedUser2.publicKey
      );
    }

    // Reset reward info accounts
    for (const rewardToken of REWARD_TOKEN_MINTS) {
      closeAccount(context, getRewardInfoPDA(folioPDA, rewardToken.publicKey));
    }

    // Init reward info if provided
    for (const rewardInfo of rewardInfos) {
      await createAndSetRewardInfo(context, programFolio, folioPDA, rewardInfo);
    }

    // Reset user reward info account
    for (const rewardToken of REWARD_TOKEN_MINTS) {
      for (const user of [rewardedUser1.publicKey, rewardedUser2.publicKey]) {
        closeAccount(
          context,
          getUserRewardInfoPDA(folioPDA, rewardToken.publicKey, user)
        );
      }
    }

    // Init reward user info if provided (
    for (const userRewardInfo of userRewardInfos) {
      await createAndSetUserRewardInfo(
        context,
        programFolio,
        folioPDA,
        userRewardInfo
      );
    }

    // Init governance accounts if provided
    let totalStakedBalance = new BN(0);

    for (const [userPubkey, amount] of Object.entries(userStakedBalances)) {
      totalStakedBalance = totalStakedBalance.add(amount);

      createGovernanceTokenRecord(
        context,
        getUserTokenRecordRealmsPDA(
          realmPDA,
          GOVERNANCE_MINT.publicKey,
          new PublicKey(userPubkey)
        ),
        amount.toNumber()
      );
    }

    // Init governance holding token account and mint
    initToken(
      context,
      // We don't care about who owns it
      adminKeypair.publicKey,
      GOVERNANCE_MINT.publicKey,
      DEFAULT_DECIMALS,
      new BN(0)
    );

    createGovernanceHoldingAccount(
      context,
      // We don't care about who owns it
      adminKeypair.publicKey,
      GOVERNANCE_MINT.publicKey,
      getGovernanceHoldingPDA(realmPDA, GOVERNANCE_MINT.publicKey),
      totalStakedBalance
    );
  }

  before(async () => {
    ({ keys, programFolioAdmin, programFolio, provider, context } =
      await getConnectors());

    banksClient = context.banksClient;

    payerKeypair = provider.wallet.payer;

    adminKeypair = Keypair.fromSecretKey(Uint8Array.from(keys.admin));

    folioTokenMint = Keypair.generate();

    await airdrop(context, payerKeypair.publicKey, 1000);
    await airdrop(context, adminKeypair.publicKey, 1000);
    await airdrop(context, rewardedUser1.publicKey, 1000);
    await airdrop(context, rewardedUser2.publicKey, 1000);

    folioPDA = getFolioPDA(folioTokenMint.publicKey);

    await initBaseCase();
  });

  describe("General Tests", () => {
    const generalIxAccrueRewards = () =>
      accrueRewards<true>(
        banksClient,
        programFolio,
        rewardedUser1,
        realmPDA,
        folioOwnerPDA,
        folioPDA,
        GOVERNANCE_MINT.publicKey,
        getGovernanceHoldingPDA(realmPDA, GOVERNANCE_MINT.publicKey),
        rewardedUser1.publicKey,
        getUserTokenRecordRealmsPDA(
          realmPDA,
          GOVERNANCE_MINT.publicKey,
          rewardedUser1.publicKey
        ),
        getUserTokenRecordRealmsPDA(
          realmPDA,
          GOVERNANCE_MINT.publicKey,
          rewardedUser1.publicKey
        ),
        true,
        []
      );

    beforeEach(async () => {
      await initBaseCase();
    });

    describe("should run general tests for accrue rewards", () => {
      it(`should run ${GeneralTestCases.InvalidFolioStatus} for both KILLED and MIGRATING`, async () => {
        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,
          generalIxAccrueRewards,
          FolioStatus.Killed
        );

        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,
          generalIxAccrueRewards,
          FolioStatus.Migrating
        );
      });
    });
  });

  describe("Specific Cases - Accrue Rewards", () => {
    TEST_ACCRUE_REWARDS.forEach(({ desc, expectedError, ...restOfParams }) => {
      describe(`When ${desc}`, () => {
        let txnResult: BanksTransactionResultWithMeta;
        const {
          customFolioTokenMint,
          customRole,
          rewardInfosAlreadyThere,
          userRewardInfosAlreadyThere,
          folioRewardTokenBalances,
          rewardsTokenToClaim,
          indexAccountToInvalidate,
          extraUserToClaimFor,
          remainingAccounts,
          userStakedBalances,
          timeToAddToClock,
          runTwice,
          expectedBalanceAccountedChanges,
          rewardRatio,
          expectedRewardIndex,
          expectedAccruedRewardsChanges,
          governanceHoldingTokenAccount,
          callerGovernanceTokenAccount,
          userGovernanceTokenAccount,
        } = {
          ...DEFAULT_PARAMS,
          ...restOfParams,
        };

        let folioMintToUse: Keypair;
        let extraUser: PublicKey;

        let callerGovernanceTokenAccountToUse: PublicKey;
        let userGovernanceTokenAccountToUse: PublicKey;

        let currentClock: Clock;

        let rewardInfosBefore: RewardInfo[];
        let userRewardInfosBefore: UserRewardInfo[];

        before(async () => {
          folioMintToUse = customFolioTokenMint || folioTokenMint;
          extraUser = extraUserToClaimFor || rewardedUser1.publicKey;

          const rewardInfosAlreadyThereToUse = await rewardInfosAlreadyThere();

          await initBaseCase(
            folioMintToUse,
            customRole,
            new BN(1000_000_000_000),
            folioRewardTokenBalances,
            rewardInfosAlreadyThereToUse,
            userRewardInfosAlreadyThere,
            userStakedBalances,
            rewardRatio
          );

          currentClock = await context.banksClient.getClock();

          await createAndSetFolio(
            context,
            programFolio,
            folioMintToUse.publicKey
          );

          callerGovernanceTokenAccountToUse =
            callerGovernanceTokenAccount() ??
            getUserTokenRecordRealmsPDA(
              realmPDA,
              GOVERNANCE_MINT.publicKey,
              rewardedUser1.publicKey
            );

          userGovernanceTokenAccountToUse =
            userGovernanceTokenAccount() ??
            getUserTokenRecordRealmsPDA(
              realmPDA,
              GOVERNANCE_MINT.publicKey,
              extraUser
            );

          await travelFutureSlot(context);

          // We'll build remaining accounts outside, so we can test the different cases
          let remainingAccountsToUse = await remainingAccounts();

          if (remainingAccountsToUse.length === 0) {
            remainingAccountsToUse =
              await buildRemainingAccountsForAccruesRewards(
                context,
                rewardedUser1,
                folioPDA,
                rewardsTokenToClaim,
                extraUser
              );
          }

          if (indexAccountToInvalidate) {
            remainingAccountsToUse = await buildRemainingAccountsAccrue(
              remainingAccountsToUse,
              indexAccountToInvalidate
            );
          }

          // Save before values, for our later assertions (only if no error, else useless)
          if (!expectedError) {
            ({
              rewardInfos: rewardInfosBefore,
              userRewardInfos: userRewardInfosBefore,
            } = await getRewardsInfoAndUserRewardInfos(
              rewardsTokenToClaim,
              extraUser
            ));
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

          txnResult = await accrueRewards<true>(
            banksClient,
            programFolio,
            rewardedUser1,
            realmPDA,
            folioOwnerPDA,
            folioPDA,
            GOVERNANCE_MINT.publicKey,
            governanceHoldingTokenAccount ??
              getGovernanceHoldingPDA(realmPDA, GOVERNANCE_MINT.publicKey),
            callerGovernanceTokenAccountToUse,
            userGovernanceTokenAccountToUse,
            extraUser,
            true,
            remainingAccountsToUse
          );

          if (runTwice) {
            await travelFutureSlot(context);

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

            txnResult = await accrueRewards<true>(
              banksClient,
              programFolio,
              rewardedUser1,
              realmPDA,
              folioOwnerPDA,
              folioPDA,
              GOVERNANCE_MINT.publicKey,
              getGovernanceHoldingPDA(realmPDA, GOVERNANCE_MINT.publicKey),
              callerGovernanceTokenAccountToUse,
              userGovernanceTokenAccountToUse,
              extraUser,
              true,
              remainingAccountsToUse
            );
          }
        });

        if (expectedError) {
          it("should fail with expected error", () => {
            assertError(txnResult, expectedError);
          });
        } else {
          it("should succeed", async () => {
            await travelFutureSlot(context);

            const { rewardInfos, userRewardInfos } =
              await getRewardsInfoAndUserRewardInfos(
                rewardsTokenToClaim,
                extraUser
              );

            for (let i = 0; i < rewardInfos.length; i++) {
              const initialRewardTokenBalanceOfFolio = (
                folioRewardTokenBalances[
                  rewardInfos[i].folioRewardToken.toBase58()
                ] ?? new BN(0)
              ).mul(D18);

              assert.equal(
                rewardInfos[i].balanceLastKnown.eq(
                  rewardInfosBefore[i].balanceLastKnown.add(
                    initialRewardTokenBalanceOfFolio
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
                    new BN(
                      runTwice
                        ? timeToAddToClock.mul(new BN(2))
                        : timeToAddToClock
                    )
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
                  rewardInfosBefore[i].rewardIndex.add(expectedRewardIndexToUse)
                ),
                true
              );
            }

            const defaultUserRewardInfo = UserRewardInfo.default(
              rewardsTokenToClaim[0],
              extraUser
            );

            const numberOfUsers = extraUser.equals(rewardedUser1.publicKey)
              ? 1
              : 2;

            for (let i = 0; i < userRewardInfos.length; i++) {
              let accruedRewardsBefore = defaultUserRewardInfo.accruedRewards;
              let lastRewardIndexBefore = defaultUserRewardInfo.lastRewardIndex;

              if (i < userRewardInfosBefore.length) {
                accruedRewardsBefore = userRewardInfosBefore[i].accruedRewards;
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
                expectedRewardIndex.length > Math.floor(i / numberOfUsers)
                  ? expectedRewardIndex[Math.floor(i / numberOfUsers)]
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
    });
  });

  describe("Specific Cases - Claim Rewards", () => {
    TEST_CLAIM_REWARDS.forEach(({ desc, expectedError, ...restOfParams }) => {
      describe(`When ${desc}`, () => {
        let txnResult: BanksTransactionResultWithMeta;
        const {
          customRole,
          rewardInfosAlreadyThere,
          userRewardInfosAlreadyThere,
          folioRewardTokenBalances,
          rewardsTokenToClaim,
          indexAccountToInvalidate,
          remainingAccounts,
          expectedRewardBalanceChanges,
        } = {
          ...DEFAULT_PARAMS,
          ...restOfParams,
        };

        let rewardInfosBefore: RewardInfo[];
        let userRewardInfosBefore: UserRewardInfo[];

        let rewardTokenBalancesBefore: any;

        before(async () => {
          const rewardInfosAlreadyThereToUse = await rewardInfosAlreadyThere();

          await initBaseCase(
            folioTokenMint,
            customRole,
            new BN(1000_000_000_000),
            folioRewardTokenBalances,
            rewardInfosAlreadyThereToUse,
            userRewardInfosAlreadyThere
          );

          await createAndSetFolio(
            context,
            programFolio,
            folioTokenMint.publicKey
          );

          await travelFutureSlot(context);

          // We'll build remaining accounts outside, so we can test the different cases
          let remainingAccountsToUse = await remainingAccounts();

          if (remainingAccountsToUse.length === 0) {
            remainingAccountsToUse =
              await buildRemainingAccountsForClaimRewards(
                context,
                rewardedUser1,
                folioPDA,
                rewardsTokenToClaim
              );
          }

          if (indexAccountToInvalidate) {
            remainingAccountsToUse = await buildRemainingAccountsAccrue(
              remainingAccountsToUse,
              indexAccountToInvalidate
            );
          }

          // Save before values, for our later assertions (only if no error, else useless)
          if (!expectedError) {
            ({
              rewardInfos: rewardInfosBefore,
              userRewardInfos: userRewardInfosBefore,
            } = await getRewardsInfoAndUserRewardInfos(
              rewardsTokenToClaim,
              rewardedUser1.publicKey
            ));

            rewardTokenBalancesBefore = await getTokenBalancesFromMints(
              context,
              rewardsTokenToClaim,
              [rewardedUser1.publicKey]
            );
          }

          txnResult = await claimRewards<true>(
            context,
            banksClient,
            programFolio,
            rewardedUser1,
            folioOwnerPDA,
            folioPDA,
            rewardsTokenToClaim,

            true,
            remainingAccountsToUse
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
              await getRewardsInfoAndUserRewardInfos(
                rewardsTokenToClaim,
                rewardedUser1.publicKey
              );

            // Assert reward infos (only total claimed changed)
            for (let i = 0; i < rewardInfos.length; i++) {
              assert.equal(
                rewardInfos[i].totalClaimed.eq(
                  rewardInfosBefore[i].totalClaimed.add(
                    // Stored in d18
                    expectedRewardBalanceChanges[i].mul(D9)
                  )
                ),
                true
              );
            }

            // Assert user reward infos (only accrued rewards and last reward index changed)
            for (let i = 0; i < userRewardInfos.length; i++) {
              // Need to be reset to 0
              assert.equal(
                userRewardInfos[i].accruedRewards.eq(new BN(0)),
                true
              );
              assert.equal(
                userRewardInfos[i].lastRewardIndex.eq(
                  userRewardInfosBefore[i].lastRewardIndex
                ),
                true
              );
            }

            // Assert reward token balances
            await assertExpectedBalancesChanges(
              context,
              rewardTokenBalancesBefore,
              rewardsTokenToClaim,
              [rewardedUser1.publicKey],
              expectedRewardBalanceChanges
            );
          });
        }
      });
    });
  });
});
