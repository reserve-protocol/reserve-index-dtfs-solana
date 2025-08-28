import { BN, Program, Provider } from "@coral-xyz/anchor";
import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";

import {
  createAndSetActor,
  createAndSetFolio,
  createAndSetDaoFeeConfig,
  createAndSetRewardTokens,
} from "../bankrun-account-helper";
import { Folio } from "../../../target/types/folio";
import {
  DEFAULT_DECIMALS,
  MAX_MINT_FEE,
  MAX_REWARD_TOKENS,
} from "../../../utils/constants";
import {
  initToken,
  initToken2022Tx,
  mintToken2022Tx,
} from "../bankrun-token-helper";
import { Role } from "../bankrun-account-helper";
import {
  airdrop,
  assertError,
  BanksTransactionResultWithMeta,
  buildExpectedArray,
  getConnectors,
  travelFutureSlot,
} from "../bankrun-program-helper";
import { getFolioPDA, getRewardTokensPDA } from "../../../utils/pda-helper";
import { addRewardToken } from "../bankrun-ix-helper";

import * as assert from "assert";
import { FolioAdmin } from "../../../target/types/folio_admin";
import {
  ExtensionType,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import {
  executeGovernanceInstruction,
  setupGovernanceAccounts,
} from "../bankrun-governance-helper";
import { Rewards } from "../../../target/types/rewards";
import { LiteSVM } from "litesvm";

/**
 * Tests for staking admin functionality with SPL Token 2022, including:
 * - Adding reward tokens
 * - Extension validation
 * - Token program compatibility checks
 */

describe("Bankrun - Staking Admin SPL 2022", () => {
  let context: LiteSVM;
  let provider: Provider;
  let banksClient: LiteSVM;

  let programFolioAdmin: Program<FolioAdmin>;
  let programRewards: Program<Rewards>;
  let programFolio: Program<Folio>;

  let keys: any;

  let payerKeypair: Keypair;
  let adminKeypair: Keypair;

  let folioOwnerPDA: PublicKey;
  let folioTokenMint: Keypair;
  let folioPDA: PublicKey;

  let realmPDA: PublicKey;
  let rewardsAdminPDA: PublicKey;

  const REWARD_TOKEN_MINT = Keypair.generate();
  let rewardTokenATA: PublicKey;

  const GOVERNANCE_MINT = Keypair.generate();

  const DEFAULT_PARAMS: {
    mintExtension: ExtensionType;
  } = {
    mintExtension: null,
  };

  const TEST_ADD_REWARD_TOKEN = [
    {
      desc: "(try with non transferable extension, errors out)",
      expectedError: "UnsupportedSPLToken",
      mintExtension: ExtensionType.NonTransferable,
    },
    {
      desc: "(try without any extensions, succeeds)",
      expectedError: null,
    },
  ];

  async function initBaseCase(mintExtension: ExtensionType) {
    ({ folioOwnerPDA, realmPDA, rewardsAdminPDA } =
      await setupGovernanceAccounts(
        context,
        adminKeypair,
        GOVERNANCE_MINT.publicKey
      ));

    await createAndSetDaoFeeConfig(
      context,
      programFolioAdmin,
      Keypair.generate().publicKey,
      MAX_MINT_FEE
    );

    await createAndSetFolio(context, programFolio, folioTokenMint.publicKey);

    folioPDA = getFolioPDA(folioTokenMint.publicKey);

    initToken(context, folioPDA, folioTokenMint, DEFAULT_DECIMALS);

    await createAndSetActor(
      context,
      programFolio,
      folioOwnerPDA,
      folioPDA,
      Role.Owner
    );

    rewardTokenATA = getAssociatedTokenAddressSync(
      REWARD_TOKEN_MINT.publicKey,
      getRewardTokensPDA(realmPDA),
      true,
      TOKEN_2022_PROGRAM_ID
    );

    // await closeAccount(context, REWARD_TOKEN_MINT.publicKey);
    // await closeAccount(context, rewardTokenATA);

    await initToken2022Tx(
      context,
      adminKeypair,
      REWARD_TOKEN_MINT,
      mintExtension,
      DEFAULT_DECIMALS
    );

    await mintToken2022Tx(
      context,
      adminKeypair,
      REWARD_TOKEN_MINT.publicKey,
      getRewardTokensPDA(realmPDA),
      new BN(1000)
    );
  }

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

  beforeEach(async () => {
    ({
      keys,
      programFolioAdmin,
      programRewards,
      programFolio,
      provider,
      context,
    } = await getConnectors());

    banksClient = context;

    payerKeypair = provider.wallet.payer;

    adminKeypair = Keypair.fromSecretKey(Uint8Array.from(keys.admin));

    folioTokenMint = Keypair.generate();

    await airdrop(context, payerKeypair.publicKey, 1000);
    await airdrop(context, adminKeypair.publicKey, 1000);

    folioPDA = getFolioPDA(folioTokenMint.publicKey);
  });

  describe("Specific Cases - Add Reward Token SPL 2022", () => {
    TEST_ADD_REWARD_TOKEN.forEach(
      ({ desc, expectedError, ...restOfParams }) => {
        describe(`When ${desc}`, () => {
          let txnResult: BanksTransactionResultWithMeta;

          const { mintExtension } = {
            ...DEFAULT_PARAMS,
            ...restOfParams,
          };

          beforeEach(async () => {
            await initBaseCase(mintExtension);

            await createAndSetFolio(
              context,
              programFolio,
              folioTokenMint.publicKey
            );

            await createAndSetRewardTokens(
              context,
              programRewards,
              realmPDA,
              rewardsAdminPDA,
              new BN(0),
              []
            );

            await travelFutureSlot(context);

            txnResult = await getGovernanceTxn(async () =>
              addRewardToken<false>(
                context,
                banksClient,
                programRewards,
                adminKeypair,
                rewardsAdminPDA,
                realmPDA,
                REWARD_TOKEN_MINT.publicKey,
                false,
                rewardTokenATA
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
                [],
                [REWARD_TOKEN_MINT.publicKey],
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
});
