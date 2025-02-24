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
  createAndSetFolioRewardTokens,
  closeAccount,
} from "../bankrun-account-helper";
import { Folio } from "../../../target/types/folio";
import {
  DEFAULT_DECIMALS,
  MAX_MINT_FEE,
  MAX_REWARD_HALF_LIFE,
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
  buildExpectedArray,
  getConnectors,
  travelFutureSlot,
} from "../bankrun-program-helper";
import {
  getFolioPDA,
  getFolioRewardTokensPDA,
} from "../../../utils/pda-helper";
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
describe("Bankrun - Staking Admin SPL 2022", () => {
  let context: ProgramTestContext;
  let provider: BankrunProvider;
  let banksClient: BanksClient;

  let programFolioAdmin: Program<FolioAdmin>;
  let programFolio: Program<Folio>;

  let keys: any;

  let payerKeypair: Keypair;
  let adminKeypair: Keypair;

  let folioOwnerPDA: PublicKey;
  let folioTokenMint: Keypair;
  let folioPDA: PublicKey;

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
      desc: "(try with transfer hook extension, errors out)",
      expectedError: "UnsupportedSPLToken",
      mintExtension: ExtensionType.TransferHook,
    },
    {
      desc: "(try with permanent delegate extension, errors out)",
      expectedError: "UnsupportedSPLToken",
      mintExtension: ExtensionType.PermanentDelegate,
    },
    {
      desc: "(try without any extensions, succeeds)",
      expectedError: null,
    },
  ];

  async function initBaseCase(mintExtension: ExtensionType) {
    ({ folioOwnerPDA } = await setupGovernanceAccounts(
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
      getFolioRewardTokensPDA(folioPDA),
      true,
      TOKEN_2022_PROGRAM_ID
    );

    await closeAccount(context, REWARD_TOKEN_MINT.publicKey);
    await closeAccount(context, rewardTokenATA);

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
      getFolioRewardTokensPDA(folioPDA),
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
      folioOwnerPDA,
      GOVERNANCE_MINT.publicKey,
      [ix]
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

          before(async () => {
            await initBaseCase(mintExtension);

            await createAndSetFolio(
              context,
              programFolio,
              folioTokenMint.publicKey
            );

            await createAndSetFolioRewardTokens(
              context,
              programFolio,
              folioPDA,
              new BN(0),
              [],
              []
            );

            await travelFutureSlot(context);

            txnResult = await getGovernanceTxn(async () =>
              addRewardToken<false>(
                context,
                banksClient,
                programFolio,
                adminKeypair,
                folioOwnerPDA,
                folioPDA,
                REWARD_TOKEN_MINT.publicKey,
                MAX_REWARD_HALF_LIFE,
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

              const folioRewardTokens =
                await programFolio.account.folioRewardTokens.fetch(
                  getFolioRewardTokensPDA(folioPDA)
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
});
