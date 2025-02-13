import { BN, Program } from "@coral-xyz/anchor";
import { BankrunProvider } from "anchor-bankrun";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  BanksClient,
  BanksTransactionResultWithMeta,
  ProgramTestContext,
} from "solana-bankrun";

import {
  createAndSetActor,
  createAndSetFolio,
  FolioStatus,
  createAndSetDaoFeeConfig,
  createAndSetFolioRewardTokens,
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
  getFolioRewardTokensPDA,
} from "../../../utils/pda-helper";
import {
  addRewardToken,
  initOrSetRewardRatio,
  removeRewardToken,
} from "../bankrun-ix-helper";
import {
  assertInvalidFolioStatusTestCase,
  assertNotValidRoleTestCase,
  GeneralTestCases,
} from "../bankrun-general-tests-helper";

import * as assert from "assert";
import { FolioAdmin } from "../../../target/types/folio_admin";
describe("Bankrun - Staking Admin", () => {
  let context: ProgramTestContext;
  let provider: BankrunProvider;
  let banksClient: BanksClient;

  let programFolioAdmin: Program<FolioAdmin>;
  let programFolio: Program<Folio>;

  let keys: any;

  let payerKeypair: Keypair;
  let adminKeypair: Keypair;

  let folioOwnerKeypair: Keypair;
  let folioTokenMint: Keypair;
  let folioPDA: PublicKey;

  const rewardedUser1: Keypair = Keypair.generate();
  const rewardedUser2: Keypair = Keypair.generate();

  const feeRecipient: Keypair = Keypair.generate();

  let userKeypair: Keypair;

  const REWARD_TOKEN_MINTS = [Keypair.generate(), Keypair.generate()];

  const DEFAULT_PARAMS: {
    customFolioTokenMint: Keypair | null;

    rewardToken: PublicKey;
    rewardPeriod: BN;

    rewardTokenATA: () => PublicKey;

    alreadyAddedTokenRewards: PublicKey[];
    disallowedTokenRewards: PublicKey[];

    expectedRewardRatio: BN;
  } = {
    customFolioTokenMint: null,

    rewardToken: null,
    rewardPeriod: MIN_REWARD_HALF_LIFE,

    rewardTokenATA: () => null,

    alreadyAddedTokenRewards: [],
    disallowedTokenRewards: [],

    expectedRewardRatio: new BN(0),
  };

  const TEST_ADD_REWARD_TOKEN = [
    {
      desc: "(reward token mint is the same as folio token mint, errors out)",
      expectedError: "InvalidRewardToken",
      customFolioTokenMint: REWARD_TOKEN_MINTS[0],
      rewardToken: REWARD_TOKEN_MINTS[0].publicKey,
    },
    {
      desc: "(reward token account's mint is not the same as the reward token mint, errors out)",
      expectedError: "InvalidRewardMint",
      rewardToken: REWARD_TOKEN_MINTS[0].publicKey,
      rewardTokenATA: () =>
        getOrCreateAtaAddress(
          context,
          REWARD_TOKEN_MINTS[1].publicKey,
          folioPDA
        ),
    },
    {
      desc: "(reward token's account owner is not folio reward tokens PDA, errors out)",
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
      desc: "(reward half life below minimum, errors out)",
      expectedError: "InvalidRewardHalfLife",
      rewardPeriod: MIN_REWARD_HALF_LIFE.sub(new BN(1)),
      rewardToken: REWARD_TOKEN_MINTS[1].publicKey,
    },
    {
      desc: "(reward half life above maximum, errors out)",
      expectedError: "InvalidRewardHalfLife",
      rewardPeriod: MAX_REWARD_HALF_LIFE.add(new BN(1)),
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
      desc: "(reward token mint is the same as folio token mint, errors out)",
      expectedError: "InvalidRewardToken",
      customFolioTokenMint: REWARD_TOKEN_MINTS[0],
      rewardToken: REWARD_TOKEN_MINTS[0].publicKey,
    },
    {
      desc: "(reward token is not registered, errors out)",
      expectedError: "RewardNotRegistered",
      alreadyAddedTokenRewards: [],
      rewardToken: REWARD_TOKEN_MINTS[1].publicKey,
    },
    {
      desc: "(no more room for new disallowed token, errors out)",
      expectedError: "NoMoreRoomForNewDisallowedToken",
      disallowedTokenRewards: Array(MAX_REWARD_TOKENS).fill(
        REWARD_TOKEN_MINTS[0].publicKey
      ),
      alreadyAddedTokenRewards: [REWARD_TOKEN_MINTS[1].publicKey],
      rewardToken: REWARD_TOKEN_MINTS[1].publicKey,
    },
    {
      desc: "(is valid, succeeds)",
      expectedError: null,
      alreadyAddedTokenRewards: [REWARD_TOKEN_MINTS[1].publicKey],
      rewardToken: REWARD_TOKEN_MINTS[1].publicKey,
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
      folioOwnerKeypair,
      folioPDA,
      Role.Owner
    );

    // Init the reward tokens
    for (const rewardTokenMint of REWARD_TOKEN_MINTS) {
      initToken(context, folioPDA, rewardTokenMint, DEFAULT_DECIMALS);

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
  }

  before(async () => {
    ({ keys, programFolioAdmin, programFolio, provider, context } =
      await getConnectors());

    banksClient = context.banksClient;

    payerKeypair = provider.wallet.payer;

    adminKeypair = Keypair.fromSecretKey(Uint8Array.from(keys.admin));

    folioOwnerKeypair = Keypair.generate();
    folioTokenMint = Keypair.generate();
    userKeypair = Keypair.generate();

    await airdrop(context, payerKeypair.publicKey, 1000);
    await airdrop(context, adminKeypair.publicKey, 1000);
    await airdrop(context, folioOwnerKeypair.publicKey, 1000);
    await airdrop(context, feeRecipient.publicKey, 1000);
    await airdrop(context, userKeypair.publicKey, 1000);

    folioPDA = getFolioPDA(folioTokenMint.publicKey);

    await initBaseCase();
  });

  describe("General Tests", () => {
    const generalIxAddRewardToken = () =>
      addRewardToken<true>(
        context,
        banksClient,
        programFolio,
        folioOwnerKeypair,
        folioPDA,
        REWARD_TOKEN_MINTS[0].publicKey,
        new BN(0),

        true
      );

    const generalIxRemoveRewardToken = () =>
      removeRewardToken<true>(
        banksClient,
        programFolio,
        folioOwnerKeypair,
        folioPDA,
        REWARD_TOKEN_MINTS[0].publicKey,

        true
      );

    const generalIxInitOrSetRewardRatio = () =>
      initOrSetRewardRatio<true>(
        banksClient,
        programFolio,
        folioOwnerKeypair,
        folioPDA,
        new BN(0),

        true
      );

    beforeEach(async () => {
      await initBaseCase();
    });

    describe("should run general tests for add reward token", () => {
      it(`should run ${GeneralTestCases.NotRole}`, async () => {
        await assertNotValidRoleTestCase(
          context,
          programFolio,
          folioOwnerKeypair,
          folioPDA,
          generalIxAddRewardToken
        );
      });

      it(`should run ${GeneralTestCases.InvalidFolioStatus} for both KILLED and MIGRATING`, async () => {
        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,

          generalIxAddRewardToken,
          FolioStatus.Killed
        );

        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,

          generalIxAddRewardToken,
          FolioStatus.Migrating
        );
      });
    });

    describe("should run general tests for remove reward token", () => {
      beforeEach(async () => {
        await createAndSetFolioRewardTokens(
          context,
          programFolio,
          folioPDA,
          new BN(0),
          [],
          []
        );
      });

      it(`should run ${GeneralTestCases.NotRole}`, async () => {
        await assertNotValidRoleTestCase(
          context,
          programFolio,
          folioOwnerKeypair,
          folioPDA,
          generalIxRemoveRewardToken
        );
      });

      it(`should run ${GeneralTestCases.InvalidFolioStatus} for both KILLED and MIGRATING`, async () => {
        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,

          generalIxRemoveRewardToken,
          FolioStatus.Killed
        );

        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,

          generalIxRemoveRewardToken,
          FolioStatus.Migrating
        );
      });
    });

    describe("should run general tests for init or set reward ratio", () => {
      it(`should run ${GeneralTestCases.NotRole}`, async () => {
        await assertNotValidRoleTestCase(
          context,
          programFolio,
          folioOwnerKeypair,
          folioPDA,
          generalIxInitOrSetRewardRatio
        );
      });

      it(`should run ${GeneralTestCases.InvalidFolioStatus} for both KILLED and MIGRATING`, async () => {
        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,

          generalIxInitOrSetRewardRatio,
          FolioStatus.Killed
        );

        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,

          generalIxInitOrSetRewardRatio,
          FolioStatus.Migrating
        );
      });
    });
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
            rewardPeriod,
            rewardTokenATA,
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

            await createAndSetFolioRewardTokens(
              context,
              programFolio,
              folioPDA,
              new BN(0),
              alreadyAddedTokenRewards,
              disallowedTokenRewards
            );

            await travelFutureSlot(context);

            txnResult = await addRewardToken<true>(
              context,
              banksClient,
              programFolio,
              folioOwnerKeypair,
              folioPDA,
              rewardToken,
              rewardPeriod,

              true,
              await rewardTokenATA()
            );
          });

          if (expectedError) {
            it("should fail with expected error", () => {
              assertError(txnResult, expectedError);
            });
          } else {
            it("should succeed", async () => {
              await travelFutureSlot(context);

              const folioRewardTokens =
                await programFolio.account.folioRewardTokens.fetch(
                  getFolioRewardTokensPDA(folioPDA)
                );

              assert.equal(
                folioRewardTokens.rewardRatio.eq(expectedRewardRatio),
                true
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
                  folioRewardTokens.rewardTokens[i].toBase58(),
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

            await createAndSetFolioRewardTokens(
              context,
              programFolio,
              folioPDA,
              new BN(0),
              alreadyAddedTokenRewards,
              disallowedTokenRewards
            );

            await travelFutureSlot(context);

            txnResult = await removeRewardToken<true>(
              banksClient,
              programFolio,
              folioOwnerKeypair,
              folioPDA,
              rewardToken,

              true
            );
          });

          if (expectedError) {
            it("should fail with expected error", () => {
              assertError(txnResult, expectedError);
            });
          } else {
            it("should succeed", async () => {
              await travelFutureSlot(context);

              const folioRewardTokens =
                await programFolio.account.folioRewardTokens.fetch(
                  getFolioRewardTokensPDA(folioPDA)
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
                  folioRewardTokens.rewardTokens[i].toBase58(),
                  expectedRewardTokensArray[i].toBase58()
                );
              }
            });
          }
        });
      }
    );
  });

  describe("Specific Cases - Init or set reward ratio", () => {
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

            await createAndSetFolioRewardTokens(
              context,
              programFolio,
              folioPDA,
              new BN(0),
              alreadyAddedTokenRewards,
              disallowedTokenRewards
            );

            await travelFutureSlot(context);

            txnResult = await initOrSetRewardRatio<true>(
              banksClient,
              programFolio,
              folioOwnerKeypair,
              folioPDA,
              rewardPeriod,

              true
            );
          });

          if (expectedError) {
            it("should fail with expected error", () => {
              assertError(txnResult, expectedError);
            });
          } else {
            it("should succeed", async () => {
              await travelFutureSlot(context);

              const folioRewardTokens =
                await programFolio.account.folioRewardTokens.fetch(
                  getFolioRewardTokensPDA(folioPDA)
                );

              assert.equal(
                folioRewardTokens.rewardRatio.eq(expectedRewardRatio),
                true
              );
            });
          }
        });
      }
    );
  });
});
