import { BN, Program } from "@coral-xyz/anchor";
import { BankrunProvider } from "anchor-bankrun";
import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import {
  BanksClient,
  BanksTransactionResultWithMeta,
  ProgramTestContext,
} from "solana-bankrun";

import {
  createAndSetActor,
  createAndSetFolio,
  createAndSetDaoFeeConfig,
  createAndSetRewardTokens,
  createAndSetRewardInfo,
  RewardInfo,
} from "../bankrun-account-helper";
import { Folio } from "../../../target/types/folio";
import {
  DEFAULT_DECIMALS,
  MAX_MINT_FEE,
  MAX_REWARD_HALF_LIFE,
  MAX_REWARD_TOKENS,
  MIN_REWARD_HALF_LIFE,
} from "../../../utils/constants";
import {
  getOrCreateAtaAddress,
  initToken,
  resetTokenBalance,
} from "../bankrun-token-helper";
import { Role } from "../bankrun-account-helper";
import {
  airdrop,
  assertError,
  buildExpectedArray,
  getConnectors,
  travelFutureSlot,
} from "../bankrun-program-helper";
import {
  getFolioPDA,
  getGovernanceHoldingPDA,
  getRewardInfoPDA,
  getRewardTokensPDA,
  getUserTokenRecordRealmsPDA,
} from "../../../utils/pda-helper";
import {
  addRewardToken,
  initOrSetRewardRatio,
  removeRewardToken,
  setRewardsAdmin,
} from "../bankrun-ix-helper";

import * as assert from "assert";

import { FolioAdmin } from "../../../target/types/folio_admin";
import {
  createGovernanceHoldingAccount,
  createGovernanceTokenRecord,
  executeGovernanceInstruction,
  setupGovernanceAccounts,
} from "../bankrun-governance-helper";
import { Rewards } from "../../../target/types/rewards";
import { TestHelper } from "../../../utils/test-helper";

/**
 * Tests for staking admin functionality, including:
 * - Adding/removing reward tokens
 * - Setting reward ratios
 * - Reward period validation
 * - Permission checks
 * - Token validation
 */

describe("Bankrun - Staking Admin", () => {
  let context: ProgramTestContext;
  let provider: BankrunProvider;
  let banksClient: BanksClient;

  let programFolioAdmin: Program<FolioAdmin>;
  let programFolio: Program<Folio>;
  let programRewards: Program<Rewards>;

  let keys: any;

  let payerKeypair: Keypair;
  let adminKeypair: Keypair;

  // Is a spl governance account
  let folioOwnerPDA: PublicKey;

  let folioTokenMint: Keypair;
  let folioPDA: PublicKey;

  const rewardedUser1: Keypair = Keypair.generate();
  const rewardedUser2: Keypair = Keypair.generate();

  const feeRecipient: Keypair = Keypair.generate();

  let userKeypair: Keypair;

  const REWARD_TOKEN_MINTS = [Keypair.generate(), Keypair.generate()];

  let realmPDA: PublicKey;
  let rewardsAdminPDA: PublicKey;
  const GOVERNANCE_MINT = Keypair.generate();

  const DEFAULT_PARAMS: {
    rewardInfos: () => Promise<RewardInfo[]>;
    customFolioTokenMint: Keypair | null;

    rewardToken: PublicKey;
    rewardPeriod: BN;

    rewardTokenATA: () => PublicKey;

    alreadyAddedTokenRewards: PublicKey[];
    disallowedTokenRewards: PublicKey[];

    expectedRewardRatio: BN;
  } = {
    rewardInfos: async () => [],
    customFolioTokenMint: null,

    rewardToken: null,
    rewardPeriod: MIN_REWARD_HALF_LIFE,

    rewardTokenATA: () => null,

    alreadyAddedTokenRewards: [],
    disallowedTokenRewards: [],

    expectedRewardRatio: new BN(0),
  };

  const TEST_SET_REWARDS_ADMIN = [
    {
      desc: "(is valid, succeeds)",
      expectedError: null,
    },
  ];

  const TEST_ADD_REWARD_TOKEN = [
    {
      desc: "(reward token account's mint is not the same as the reward token mint, errors out)",
      expectedError: "InvalidRewardMint",
      rewardToken: REWARD_TOKEN_MINTS[0].publicKey,
      rewardTokenATA: () =>
        getOrCreateAtaAddress(
          context,
          REWARD_TOKEN_MINTS[1].publicKey,
          rewardsAdminPDA
        ),
    },
    {
      desc: "(reward token's account owner is not reward tokens PDA, errors out)",
      expectedError: "InvalidRewardTokenAccount",
      rewardToken: REWARD_TOKEN_MINTS[0].publicKey,
      rewardTokenATA: () =>
        getOrCreateAtaAddress(
          context,
          REWARD_TOKEN_MINTS[0].publicKey,
          feeRecipient.publicKey
        ),
    },
    {
      desc: "(tries to add a disallowed token, errors out)",
      expectedError: "DisallowedRewardToken",
      rewardToken: REWARD_TOKEN_MINTS[0].publicKey,
      disallowedTokenRewards: [REWARD_TOKEN_MINTS[0].publicKey],
    },
    {
      desc: "(tries to add a reward token that is already registered, errors out)",
      expectedError: "RewardAlreadyRegistered",
      alreadyAddedTokenRewards: [REWARD_TOKEN_MINTS[0].publicKey],
      rewardToken: REWARD_TOKEN_MINTS[0].publicKey,
    },
    {
      desc: "(no more room for new reward token, errors out)",
      expectedError: "NoMoreRoomForNewRewardToken",
      alreadyAddedTokenRewards: Array(MAX_REWARD_TOKENS).fill(
        REWARD_TOKEN_MINTS[0].publicKey
      ),
      rewardToken: REWARD_TOKEN_MINTS[1].publicKey,
    },
    {
      desc: "(is first add, is valid, succeeds)",
      expectedError: null,
      alreadyAddedTokenRewards: [],
      rewardToken: REWARD_TOKEN_MINTS[1].publicKey,
      expectedRewardRatio: new BN(8022536812036),
    },
    {
      desc: "(is second add, is valid, succeeds)",
      expectedError: null,
      alreadyAddedTokenRewards: [REWARD_TOKEN_MINTS[1].publicKey],
      rewardToken: REWARD_TOKEN_MINTS[0].publicKey,
      expectedRewardRatio: new BN(8022536812036),
    },
  ];

  const TEST_REMOVE_REWARD_TOKEN = [
    {
      desc: "(reward token is not registered, errors out)",
      expectedError: "RewardNotRegistered",
      alreadyAddedTokenRewards: [],
      rewardToken: REWARD_TOKEN_MINTS[1].publicKey,
      rewardInfos: async () => [
        await RewardInfo.default(context, REWARD_TOKEN_MINTS[1].publicKey),
      ],
    },
    {
      desc: "(is valid, succeeds)",
      expectedError: null,
      alreadyAddedTokenRewards: [REWARD_TOKEN_MINTS[1].publicKey],
      rewardToken: REWARD_TOKEN_MINTS[1].publicKey,
      rewardInfos: async () => [
        await RewardInfo.default(context, REWARD_TOKEN_MINTS[1].publicKey),
      ],
    },
  ];

  const TEST_INIT_OR_SET_REWARD_RATIO = [
    {
      desc: "(reward half life below minimum, errors out)",
      expectedError: "InvalidRewardHalfLife",
      rewardPeriod: MIN_REWARD_HALF_LIFE.sub(new BN(1)),
    },
    {
      desc: "(reward half life above maximum, errors out)",
      expectedError: "InvalidRewardHalfLife",
      rewardPeriod: MAX_REWARD_HALF_LIFE.add(new BN(1)),
    },
    {
      desc: "(is valid, succeeds)",
      expectedError: null,
      rewardPeriod: MAX_REWARD_HALF_LIFE,
      // Max reward half life is 14x min
      expectedRewardRatio: new BN(573038343716),
    },
  ];

  async function initBaseCase(
    customFolioTokenMint: Keypair | null = null,
    customFolioTokenSupply: BN = new BN(0)
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
      feeRecipient.publicKey,
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
      Role.Owner
    );

    const rewardTokensPDA = getRewardTokensPDA(realmPDA);

    // Init the reward tokens
    for (const rewardTokenMint of REWARD_TOKEN_MINTS) {
      initToken(context, rewardsAdminPDA, rewardTokenMint, DEFAULT_DECIMALS);
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

      // Create associated token account for the reward token
      await getOrCreateAtaAddress(
        context,
        rewardTokenMint.publicKey,
        rewardsAdminPDA
      );
      // Create associated token account for the reward token
      await getOrCreateAtaAddress(
        context,
        rewardTokenMint.publicKey,
        rewardTokensPDA
      );
    }

    // Governance accounts
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
      new BN(0)
    );

    createGovernanceTokenRecord(
      context,
      getUserTokenRecordRealmsPDA(
        realmPDA,
        GOVERNANCE_MINT.publicKey,
        new PublicKey(userKeypair.publicKey)
      ),
      0
    );
  }

  before(async () => {
    ({
      keys,
      programFolioAdmin,
      programFolio,
      programRewards,
      provider,
      context,
    } = await getConnectors());

    banksClient = context.banksClient;

    payerKeypair = provider.wallet.payer;

    adminKeypair = Keypair.fromSecretKey(Uint8Array.from(keys.admin));

    folioTokenMint = Keypair.generate();
    userKeypair = Keypair.generate();

    await airdrop(context, payerKeypair.publicKey, 1000);
    await airdrop(context, adminKeypair.publicKey, 1000);
    await airdrop(context, feeRecipient.publicKey, 1000);
    await airdrop(context, userKeypair.publicKey, 1000);

    folioPDA = getFolioPDA(folioTokenMint.publicKey);

    await initBaseCase();
  });

  async function getGovernanceTxn(
    instruction: () => Promise<{
      ix: TransactionInstruction;
      extraSigners: any[];
    }>
  ) {
    const { ix } = await instruction();

    return executeGovernanceInstruction(
      context,
      // Can be any keypair that acts as executor
      adminKeypair,
      rewardsAdminPDA,
      GOVERNANCE_MINT.publicKey,
      [ix]
    );
  }

  describe("Specific Cases - Set Rewards Admin", () => {
    TEST_SET_REWARDS_ADMIN.forEach(
      ({ desc, expectedError, ...restOfParams }) => {
        describe(`When ${desc}`, () => {
          let txnResult: BanksTransactionResultWithMeta;
          const {} = {
            ...DEFAULT_PARAMS,
            ...restOfParams,
          };

          before(async () => {
            await initBaseCase(folioTokenMint, new BN(1000_000_000_000));

            await travelFutureSlot(context);

            txnResult = await getGovernanceTxn(async () =>
              setRewardsAdmin<false>(
                banksClient,
                programRewards,
                adminKeypair,
                rewardsAdminPDA,
                realmPDA,
                false
              )
            );
          });

          if (expectedError) {
            it("should fail with expected error", () => {
              assertError(txnResult, expectedError);
            });
          } else {
            it("should succeed", async () => {
              await travelFutureSlot(context);

              const rewardTokens =
                await programRewards.account.rewardTokens.fetch(
                  getRewardTokensPDA(realmPDA)
                );

              assert.deepEqual(
                rewardTokens.rewardsAdmin.equals(rewardsAdminPDA),
                true
              );
            });
          }
        });
      }
    );
  });

  describe("Specific Cases - Add Reward Token", () => {
    TEST_ADD_REWARD_TOKEN.forEach(
      ({ desc, expectedError, ...restOfParams }) => {
        describe(`When ${desc}`, () => {
          let txnResult: BanksTransactionResultWithMeta;
          const {
            customFolioTokenMint,
            rewardToken,
            alreadyAddedTokenRewards,
            disallowedTokenRewards,
            rewardTokenATA,
          } = {
            ...DEFAULT_PARAMS,
            ...restOfParams,
          };

          let folioMintToUse: Keypair;

          before(async () => {
            folioMintToUse = customFolioTokenMint || folioTokenMint;

            await initBaseCase(folioMintToUse, new BN(1000_000_000_000));

            await createAndSetFolio(
              context,
              programFolio,
              folioMintToUse.publicKey
            );

            await createAndSetRewardTokens(
              context,
              programRewards,
              realmPDA,
              rewardsAdminPDA,
              new BN(0),
              alreadyAddedTokenRewards
            );

            // Clean up past disallowed
            for (const alreadyAddedToken of alreadyAddedTokenRewards) {
              const rewardInfo = {
                ...(await RewardInfo.default(context, alreadyAddedToken)),
                isDisallowed: false,
              };
              await createAndSetRewardInfo(
                context,
                programRewards,
                realmPDA,
                rewardInfo
              );
            }

            for (const disallowedToken of disallowedTokenRewards) {
              const rewardInfo = {
                ...(await RewardInfo.default(context, disallowedToken)),
                isDisallowed: true,
              };
              await createAndSetRewardInfo(
                context,
                programRewards,
                realmPDA,
                rewardInfo
              );
            }

            await travelFutureSlot(context);

            txnResult = await getGovernanceTxn(async () =>
              addRewardToken<false>(
                context,
                banksClient,
                programRewards,
                adminKeypair,
                rewardsAdminPDA,
                realmPDA,
                rewardToken,
                false,
                await rewardTokenATA()
              )
            );
          });

          if (expectedError) {
            it("should fail with expected error", () => {
              assertError(txnResult, expectedError);
            });
          } else {
            it("should succeed", async () => {
              await travelFutureSlot(context);

              const rewardTokens =
                await programRewards.account.rewardTokens.fetch(
                  getRewardTokensPDA(realmPDA)
                );

              const expectedRewardTokensArray = buildExpectedArray(
                alreadyAddedTokenRewards,
                [rewardToken],
                [],
                MAX_REWARD_TOKENS,
                PublicKey.default,
                () => true
              );

              for (let i = 0; i < MAX_REWARD_TOKENS; i++) {
                assert.equal(
                  rewardTokens.rewardTokens[i].toBase58(),
                  expectedRewardTokensArray[i].toBase58()
                );
              }
            });
          }
        });
      }
    );
  });

  describe("Specific Cases - Remove Reward Token", () => {
    TEST_REMOVE_REWARD_TOKEN.forEach(
      ({ desc, expectedError, ...restOfParams }) => {
        describe(`When ${desc}`, () => {
          let txnResult: BanksTransactionResultWithMeta;
          const {
            customFolioTokenMint,
            rewardToken,
            alreadyAddedTokenRewards,
            disallowedTokenRewards,
            rewardInfos,
          } = {
            ...DEFAULT_PARAMS,
            ...restOfParams,
          };

          let folioMintToUse: Keypair;

          before(async () => {
            folioMintToUse = customFolioTokenMint || folioTokenMint;

            await initBaseCase(folioMintToUse, new BN(1000_000_000_000));

            await createAndSetFolio(
              context,
              programFolio,
              folioMintToUse.publicKey
            );

            await createAndSetRewardTokens(
              context,
              programRewards,
              realmPDA,
              rewardsAdminPDA,
              new BN(0),
              alreadyAddedTokenRewards
            );

            for (const disallowedToken of disallowedTokenRewards) {
              const rewardInfo = {
                ...(await RewardInfo.default(context, disallowedToken)),
                isDisallowed: true,
              };
              await createAndSetRewardInfo(
                context,
                programRewards,
                realmPDA,
                rewardInfo
              );
            }

            await travelFutureSlot(context);

            // Init reward info if provided
            const rewardInfosPresent = await rewardInfos();
            for (const rewardInfo of rewardInfosPresent) {
              await createAndSetRewardInfo(
                context,
                programRewards,
                realmPDA,
                rewardInfo
              );
            }

            txnResult = await getGovernanceTxn(async () =>
              removeRewardToken<false>(
                banksClient,
                programRewards,
                adminKeypair,
                rewardsAdminPDA,
                realmPDA,
                rewardToken,
                GOVERNANCE_MINT.publicKey,
                false
              )
            );
          });

          if (expectedError) {
            it("should fail with expected error", () => {
              assertError(txnResult, expectedError);
            });
          } else {
            it("should succeed", async () => {
              await travelFutureSlot(context);

              const rewardTokens =
                await programRewards.account.rewardTokens.fetch(
                  getRewardTokensPDA(realmPDA)
                );

              const removedMints = [rewardToken];

              const expectedRewardTokensArray = buildExpectedArray(
                alreadyAddedTokenRewards,
                [],
                removedMints,
                MAX_REWARD_TOKENS,
                PublicKey.default,
                (rewardToken) =>
                  !removedMints.some((ta) => ta.equals(rewardToken))
              );

              for (let i = 0; i < MAX_REWARD_TOKENS; i++) {
                assert.equal(
                  rewardTokens.rewardTokens[i].toBase58(),
                  expectedRewardTokensArray[i].toBase58()
                );
              }

              const rewardInfo = await programRewards.account.rewardInfo.fetch(
                getRewardInfoPDA(realmPDA, rewardToken)
              );
              const currentTime = new BN(
                (await context.banksClient.getClock()).unixTimestamp.toString()
              );
              TestHelper.assertTime(rewardInfo.payoutLastPaid, currentTime);
            });
          }
        });
      }
    );
  });

  describe("Specific Cases - Init or Set Reward Ratio", () => {
    TEST_INIT_OR_SET_REWARD_RATIO.forEach(
      ({ desc, expectedError, ...restOfParams }) => {
        describe(`When ${desc}`, () => {
          let txnResult: BanksTransactionResultWithMeta;
          const {
            customFolioTokenMint,
            alreadyAddedTokenRewards,
            disallowedTokenRewards,
            rewardPeriod,
            expectedRewardRatio,
          } = {
            ...DEFAULT_PARAMS,
            ...restOfParams,
          };

          let folioMintToUse: Keypair;

          before(async () => {
            folioMintToUse = customFolioTokenMint || folioTokenMint;

            await initBaseCase(folioMintToUse, new BN(1000_000_000_000));

            await createAndSetFolio(
              context,
              programFolio,
              folioMintToUse.publicKey
            );

            await createAndSetRewardTokens(
              context,
              programRewards,
              realmPDA,
              rewardsAdminPDA,
              new BN(0),
              alreadyAddedTokenRewards
            );

            for (const disallowedToken of disallowedTokenRewards) {
              const rewardInfo = {
                ...(await RewardInfo.default(context, disallowedToken)),
                isDisallowed: true,
              };
              await createAndSetRewardInfo(
                context,
                programRewards,
                realmPDA,
                rewardInfo
              );
            }

            await travelFutureSlot(context);

            txnResult = await getGovernanceTxn(async () =>
              initOrSetRewardRatio<false>(
                banksClient,
                programRewards,
                adminKeypair,
                rewardsAdminPDA,
                realmPDA,
                GOVERNANCE_MINT.publicKey,
                getGovernanceHoldingPDA(realmPDA, GOVERNANCE_MINT.publicKey),
                getUserTokenRecordRealmsPDA(
                  realmPDA,
                  GOVERNANCE_MINT.publicKey,
                  new PublicKey(userKeypair.publicKey)
                ),
                rewardPeriod,
                false
              )
            );
          });

          if (expectedError) {
            it("should fail with expected error", () => {
              assertError(txnResult, expectedError);
            });
          } else {
            it("should succeed", async () => {
              await travelFutureSlot(context);

              const rewardTokens =
                await programRewards.account.rewardTokens.fetch(
                  getRewardTokensPDA(realmPDA)
                );

              assert.equal(
                rewardTokens.rewardRatio.eq(expectedRewardRatio),
                true
              );
            });
          }
        });
      }
    );
  });
});
