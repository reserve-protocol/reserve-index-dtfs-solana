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
  mockDTFProgramData,
  createAndSetDTFProgramSigner,
  createAndSetFolio,
  createAndSetProgramRegistrar,
  FolioStatus,
  createAndSetDaoFeeConfig,
  createAndSetFolioRewardTokens,
  RewardInfo,
  UserRewardInfo,
  createAndSetRewardInfo,
  createAndSetUserRewardInfo,
  buildRemainingAccountsForAccruesRewards,
  createGovernanceAccount,
  buildRemainingAccountsForClaimRewards,
} from "../bankrun-account-helper";
import { Folio } from "../../../target/types/folio";
import { Dtfs } from "../../../target/types/dtfs";
import {
  DEFAULT_DECIMALS,
  DEFAULT_DECIMALS_MUL,
  DTF_PROGRAM_ID,
  MIN_DAO_MINTING_FEE,
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
  getProgramDataPDA,
  getRewardInfoPDA,
  getUserRewardInfoPDA,
  getUserTokenRecordRealmsPDA,
} from "../../../utils/pda-helper";
import { accrueRewards, claimRewards } from "../bankrun-ix-helper";
import {
  assertInvalidDtfProgramDeploymentSlotTestCase,
  assertInvalidFolioStatusTestCase,
  assertProgramNotInRegistrarTestCase,
  GeneralTestCases,
} from "../bankrun-general-tests-helper";
import { deserializeU256 } from "../../../utils/math-helper";
import * as assert from "assert";

describe("Bankrun - Staking User", () => {
  let context: ProgramTestContext;
  let provider: BankrunProvider;
  let banksClient: BanksClient;

  let programDtf: Program<Dtfs>;
  let programFolio: Program<Folio>;

  let keys: any;

  let payerKeypair: Keypair;
  let adminKeypair: Keypair;

  let folioOwnerKeypair: Keypair;
  let folioTokenMint: Keypair;
  let folioPDA: PublicKey;

  const rewardedUser1: Keypair = Keypair.generate();
  const rewardedUser2: Keypair = Keypair.generate();

  const VALID_DEPLOYMENT_SLOT = new BN(1);
  const PROGRAM_VERSION_VALID = Keypair.generate().publicKey;

  const REWARD_TOKEN_MINTS = [Keypair.generate(), Keypair.generate()];

  const INDEX_FOR_REMAINING_ACCOUNTS = {
    REWARD_TOKEN: 0,
    REWARD_INFO: 1,
    REWARD_TOKEN_ATA: 2,
    USER_REWARD_INFO: 3,
    USER_GOVERNANCE: 4,
    EXTRA_USER_REWARD_INFO: 5,
    EXTRA_USER_GOVERNANCE: 6,
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

    rewardsTokenToClaim: PublicKey[];
    extraUserToClaimFor: PublicKey;

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

    rewardsTokenToClaim: [],
    extraUserToClaimFor: null,

    expectedRewardBalanceChanges: [],
  };

  const TEST_ACCRUE_REWARDS = [
    {
      desc: "(passes the wrong folio owner as account [not as signer, just not the right one], errors out)",
      expectedError: "InvalidFolioOwner",
      customRole: Role.TradeLauncher,
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
      indexAccountToInvalidate: INDEX_FOR_REMAINING_ACCOUNTS.USER_GOVERNANCE,
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
      indexAccountToInvalidate:
        INDEX_FOR_REMAINING_ACCOUNTS.EXTRA_USER_GOVERNANCE,
      extraUserToClaimFor: rewardedUser2.publicKey,
    },
    {
      desc: "(accrue for both users and rewards, does not error out)",
      expectedError: null,
      rewardInfosAlreadyThere: async () => [
        await RewardInfo.default(context, REWARD_TOKEN_MINTS[0].publicKey),
        await RewardInfo.default(context, REWARD_TOKEN_MINTS[1].publicKey),
      ],
      userStakedBalances: {
        [rewardedUser1.publicKey.toBase58()]: new BN(100),
        [rewardedUser2.publicKey.toBase58()]: new BN(200),
      },
      folioRewardTokenBalances: {
        [REWARD_TOKEN_MINTS[0].publicKey.toBase58()]: new BN(100),
        [REWARD_TOKEN_MINTS[1].publicKey.toBase58()]: new BN(1000),
      },
      rewardsTokenToClaim: [
        REWARD_TOKEN_MINTS[0].publicKey,
        // REWARD_TOKEN_MINTS[1].publicKey,
      ],
      timeToAddToClock: new BN(10),
      extraUserToClaimFor: rewardedUser2.publicKey,
      expectedRewardBalanceChanges: [
        new BN(100),
        new BN(1000),
        new BN(100),
        new BN(1000),
      ],
      runTwice: true,
    },
    // Testing how long before we get a math overflow
    {
      desc: "(accrue for both users and rewards, 60 seconds later, errors out)",
      expectedError: null,
      rewardInfosAlreadyThere: async () => [
        await RewardInfo.default(context, REWARD_TOKEN_MINTS[0].publicKey),
        await RewardInfo.default(context, REWARD_TOKEN_MINTS[1].publicKey),
      ],
      userStakedBalances: {
        [rewardedUser1.publicKey.toBase58()]: new BN(100),
        [rewardedUser2.publicKey.toBase58()]: new BN(200),
      },
      folioRewardTokenBalances: {
        [REWARD_TOKEN_MINTS[0].publicKey.toBase58()]: new BN(100),
        [REWARD_TOKEN_MINTS[1].publicKey.toBase58()]: new BN(1000),
      },
      rewardsTokenToClaim: [
        REWARD_TOKEN_MINTS[0].publicKey,
        // REWARD_TOKEN_MINTS[1].publicKey,
      ],
      timeToAddToClock: new BN(60),
      extraUserToClaimFor: rewardedUser2.publicKey,
      expectedRewardBalanceChanges: [
        new BN(100),
        new BN(1000),
        new BN(100),
        new BN(1000),
      ],
      runTwice: true,
    },
    {
      desc: "(accrue for both users and rewards, 3,600 seconds (1h) later, errors out)",
      expectedError: null,
      rewardInfosAlreadyThere: async () => [
        await RewardInfo.default(context, REWARD_TOKEN_MINTS[0].publicKey),
        await RewardInfo.default(context, REWARD_TOKEN_MINTS[1].publicKey),
      ],
      userStakedBalances: {
        [rewardedUser1.publicKey.toBase58()]: new BN(100),
        [rewardedUser2.publicKey.toBase58()]: new BN(200),
      },
      folioRewardTokenBalances: {
        [REWARD_TOKEN_MINTS[0].publicKey.toBase58()]: new BN(100),
        [REWARD_TOKEN_MINTS[1].publicKey.toBase58()]: new BN(1000),
      },
      rewardsTokenToClaim: [
        REWARD_TOKEN_MINTS[0].publicKey,
        // REWARD_TOKEN_MINTS[1].publicKey,
      ],
      timeToAddToClock: new BN(3600),
      extraUserToClaimFor: rewardedUser2.publicKey,
      expectedRewardBalanceChanges: [
        new BN(100),
        new BN(1000),
        new BN(100),
        new BN(1000),
      ],
      runTwice: true,
    },
    {
      desc: "(accrue for both users and rewards, 86,400 seconds (1d) later, errors out)",
      expectedError: null,
      rewardInfosAlreadyThere: async () => [
        await RewardInfo.default(context, REWARD_TOKEN_MINTS[0].publicKey),
        await RewardInfo.default(context, REWARD_TOKEN_MINTS[1].publicKey),
      ],
      userStakedBalances: {
        [rewardedUser1.publicKey.toBase58()]: new BN(100),
        [rewardedUser2.publicKey.toBase58()]: new BN(200),
      },
      folioRewardTokenBalances: {
        [REWARD_TOKEN_MINTS[0].publicKey.toBase58()]: new BN(100),
        [REWARD_TOKEN_MINTS[1].publicKey.toBase58()]: new BN(1000),
      },
      rewardsTokenToClaim: [
        REWARD_TOKEN_MINTS[0].publicKey,
        // REWARD_TOKEN_MINTS[1].publicKey,
      ],
      timeToAddToClock: new BN(86400),
      extraUserToClaimFor: rewardedUser2.publicKey,
      expectedRewardBalanceChanges: [
        new BN(100),
        new BN(1000),
        new BN(100),
        new BN(1000),
      ],
      runTwice: true,
    },
  ];

  const TEST_CLAIM_REWARDS = [
    {
      desc: "(passes the wrong folio owner as account [not as signer, just not the right one], errors out)",
      expectedError: "InvalidFolioOwner",
      customRole: Role.TradeLauncher,
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
        [REWARD_TOKEN_MINTS[0].publicKey.toBase58()]: new BN(100),
      },
      rewardInfosAlreadyThere: async () => [
        await RewardInfo.default(context, REWARD_TOKEN_MINTS[0].publicKey),
      ],
      userRewardInfosAlreadyThere: [
        new UserRewardInfo(
          REWARD_TOKEN_MINTS[0].publicKey,
          rewardedUser1.publicKey,
          new BN(1),
          new BN(5)
        ),
      ],
      rewardsTokenToClaim: [REWARD_TOKEN_MINTS[0].publicKey],
      expectedRewardBalanceChanges: [new BN(5)],
    },
  ];

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
    } else if (
      [
        INDEX_FOR_REMAINING_ACCOUNTS.EXTRA_USER_GOVERNANCE,
        INDEX_FOR_REMAINING_ACCOUNTS.USER_GOVERNANCE,
      ].includes(indexAccountToInvalidate)
    ) {
      const invalidGovernanceAccount = getUserTokenRecordRealmsPDA(
        folioOwnerKeypair.publicKey,
        folioTokenMint.publicKey,
        Keypair.generate().publicKey
      );

      createGovernanceAccount(context, invalidGovernanceAccount, 0);

      remainingAccounts[indexAccountToInvalidate].pubkey =
        invalidGovernanceAccount;
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
          new BN(deserializeU256(rewardInfo.rewardIndex.value).toString()),
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
            new BN(
              deserializeU256(userRewardInfo.lastRewardIndex.value).toString()
            ),
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
    } = {}
  ) {
    await createAndSetDTFProgramSigner(context, programDtf);
    await createAndSetProgramRegistrar(context, programFolio, [
      DTF_PROGRAM_ID,
      PROGRAM_VERSION_VALID,
    ]);

    await createAndSetDaoFeeConfig(
      context,
      programDtf,
      new Keypair().publicKey,
      MIN_DAO_MINTING_FEE
    );

    const folioTokenMintToUse = customFolioTokenMint || folioTokenMint;

    await createAndSetFolio(
      context,
      programFolio,
      folioTokenMintToUse.publicKey,
      DTF_PROGRAM_ID,
      VALID_DEPLOYMENT_SLOT
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
      folioOwnerKeypair,
      folioPDA,
      customRole
    );

    await createAndSetFolioRewardTokens(
      context,
      programFolio,
      folioPDA,
      new BN(8_022_536_812_037), // LN2 / min reward ratio available
      REWARD_TOKEN_MINTS.map((mint) => mint.publicKey),
      []
    );

    const folioRewardTokensPDA = getFolioRewardTokensPDA(folioPDA);

    // Init the reward tokens
    for (const rewardTokenMint of REWARD_TOKEN_MINTS) {
      let supply = new BN(0);
      // Mint token to the PDA for rewards
      if (initialRewardTokenBalances[rewardTokenMint.publicKey.toBase58()]) {
        supply =
          initialRewardTokenBalances[rewardTokenMint.publicKey.toBase58()];

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

    // Init reward info if provided
    for (const rewardInfo of rewardInfos) {
      await createAndSetRewardInfo(context, programFolio, folioPDA, rewardInfo);
    }

    // Init reward user info if provided
    for (const userRewardInfo of userRewardInfos) {
      await createAndSetUserRewardInfo(
        context,
        programFolio,
        folioPDA,
        userRewardInfo
      );
    }

    // Init governance accounts if provided
    for (const [userPubkey, amount] of Object.entries(userStakedBalances)) {
      createGovernanceAccount(
        context,
        getUserTokenRecordRealmsPDA(
          folioOwnerKeypair.publicKey,
          folioTokenMint.publicKey,
          new PublicKey(userPubkey)
        ),
        amount.toNumber()
      );
    }

    await mockDTFProgramData(context, DTF_PROGRAM_ID, VALID_DEPLOYMENT_SLOT);
  }

  before(async () => {
    ({ keys, programDtf, programFolio, provider, context } =
      await getConnectors());

    banksClient = context.banksClient;

    payerKeypair = provider.wallet.payer;

    adminKeypair = Keypair.fromSecretKey(Uint8Array.from(keys.admin));

    folioOwnerKeypair = Keypair.generate();
    folioTokenMint = Keypair.generate();

    await airdrop(context, payerKeypair.publicKey, 1000);
    await airdrop(context, adminKeypair.publicKey, 1000);
    await airdrop(context, folioOwnerKeypair.publicKey, 1000);
    await airdrop(context, rewardedUser1.publicKey, 1000);
    await airdrop(context, rewardedUser2.publicKey, 1000);

    folioPDA = getFolioPDA(folioTokenMint.publicKey);

    await initBaseCase();
  });

  describe("General Tests", () => {
    const generalIxAccrueRewards = () =>
      accrueRewards<true>(
        context,
        banksClient,
        programDtf,
        rewardedUser1,
        folioOwnerKeypair.publicKey,
        folioPDA,
        [REWARD_TOKEN_MINTS[0].publicKey],
        rewardedUser1.publicKey,
        DTF_PROGRAM_ID,
        getProgramDataPDA(DTF_PROGRAM_ID),
        true,
        []
      );

    const generalIxClaimRewards = () =>
      claimRewards<true>(
        context,
        banksClient,
        programDtf,
        rewardedUser1,
        folioOwnerKeypair.publicKey,
        folioPDA,
        [REWARD_TOKEN_MINTS[0].publicKey],
        DTF_PROGRAM_ID,
        getProgramDataPDA(DTF_PROGRAM_ID),
        true,
        []
      );

    beforeEach(async () => {
      await initBaseCase();
    });

    describe("should run general tests for accrue rewards", () => {
      it(`should run ${GeneralTestCases.InvalidDtfProgramDeploymentSlot}`, async () => {
        await assertInvalidDtfProgramDeploymentSlotTestCase(
          context,
          VALID_DEPLOYMENT_SLOT.add(new BN(1)),
          generalIxAccrueRewards
        );
      });

      it(`should run ${GeneralTestCases.ProgramNotInRegistrar}`, async () => {
        await assertProgramNotInRegistrarTestCase(
          context,
          programFolio,
          generalIxAccrueRewards
        );
      });

      it(`should run ${GeneralTestCases.InvalidFolioStatus} for both KILLED`, async () => {
        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,
          DTF_PROGRAM_ID,
          VALID_DEPLOYMENT_SLOT,
          generalIxAccrueRewards,
          FolioStatus.Killed
        );
      });
    });

    describe("should run general tests for claim rewards", () => {
      it(`should run ${GeneralTestCases.InvalidDtfProgramDeploymentSlot}`, async () => {
        await assertInvalidDtfProgramDeploymentSlotTestCase(
          context,
          VALID_DEPLOYMENT_SLOT.add(new BN(1)),
          generalIxClaimRewards
        );
      });

      it(`should run ${GeneralTestCases.ProgramNotInRegistrar}`, async () => {
        await assertProgramNotInRegistrarTestCase(
          context,
          programFolio,
          generalIxClaimRewards
        );
      });

      it(`should run ${GeneralTestCases.InvalidFolioStatus} for both KILLED`, async () => {
        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,
          DTF_PROGRAM_ID,
          VALID_DEPLOYMENT_SLOT,
          generalIxClaimRewards,
          FolioStatus.Killed
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
        } = {
          ...DEFAULT_PARAMS,
          ...restOfParams,
        };

        let folioMintToUse: Keypair;
        let extraUser: PublicKey;

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
            userStakedBalances
          );

          currentClock = await context.banksClient.getClock();

          await createAndSetFolio(
            context,
            programFolio,
            folioMintToUse.publicKey,
            DTF_PROGRAM_ID,
            VALID_DEPLOYMENT_SLOT
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
                folioMintToUse.publicKey,
                folioOwnerKeypair.publicKey,
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
            context,
            banksClient,
            programDtf,
            rewardedUser1,
            folioOwnerKeypair.publicKey,
            folioPDA,
            rewardsTokenToClaim,
            extraUser,
            DTF_PROGRAM_ID,
            getProgramDataPDA(DTF_PROGRAM_ID),
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
              context,
              banksClient,
              programDtf,
              rewardedUser1,
              folioOwnerKeypair.publicKey,
              folioPDA,
              rewardsTokenToClaim,
              extraUser,
              DTF_PROGRAM_ID,
              getProgramDataPDA(DTF_PROGRAM_ID),
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
              ).mul(new BN(DEFAULT_DECIMALS_MUL));

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

              // TODO
              // assert.equal(
              //   rewardInfos[i].payoutLastPaid.eq(
              //     rewardInfosBefore[i].payoutLastPaid.add(
              //       new BN(
              //         runTwice
              //           ? timeToAddToClock.mul(new BN(2))
              //           : timeToAddToClock
              //       )
              //     )
              //   ),
              //   true
              // );

              //TODO For now > but will make it more precise when we have the correct logic
              assert.equal(
                rewardInfos[i].balanceAccounted.gte(
                  rewardInfosBefore[i].balanceAccounted
                ),
                true
              );

              assert.equal(
                rewardInfos[i].rewardIndex.gte(
                  rewardInfosBefore[i].rewardIndex
                ),
                true
              );
            }

            const defaultUserRewardInfo = UserRewardInfo.default(
              rewardsTokenToClaim[0],
              extraUser
            );
            for (let i = 0; i < userRewardInfos.length; i++) {
              let accruedRewardsBefore = defaultUserRewardInfo.accruedRewards;
              let lastRewardIndexBefore = defaultUserRewardInfo.lastRewardIndex;

              // Might get initialized in the instruction itself
              if (i < userRewardInfosBefore.length) {
                accruedRewardsBefore = userRewardInfosBefore[i].accruedRewards;
                lastRewardIndexBefore =
                  userRewardInfosBefore[i].lastRewardIndex;
              }

              // TODO For now > but will make it more precise when we have the correct logic
              assert.equal(
                userRewardInfos[i].accruedRewards.gte(accruedRewardsBefore),
                true
              );
              assert.equal(
                userRewardInfos[i].lastRewardIndex.gte(lastRewardIndexBefore),
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
            folioTokenMint.publicKey,
            DTF_PROGRAM_ID,
            VALID_DEPLOYMENT_SLOT
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
            programDtf,
            rewardedUser1,
            folioOwnerKeypair.publicKey,
            folioPDA,
            rewardsTokenToClaim,
            DTF_PROGRAM_ID,
            getProgramDataPDA(DTF_PROGRAM_ID),
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
                    expectedRewardBalanceChanges[i]
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
