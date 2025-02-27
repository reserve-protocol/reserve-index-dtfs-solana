import { BN, Program } from "@coral-xyz/anchor";
import { BankrunProvider } from "anchor-bankrun";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  BanksClient,
  BanksTransactionResultWithMeta,
  ProgramTestContext,
} from "solana-bankrun";
import {
  airdrop,
  assertError,
  getConnectors,
  travelFutureSlot,
} from "../bankrun-program-helper";
import { setDaoFeeConfig, setFolioFeeConfig } from "../bankrun-ix-helper";
import {
  getDAOFeeConfigPDA,
  getFeeDistributionPDA,
  getFolioFeeConfigPDA,
  getFolioPDA,
} from "../../../utils/pda-helper";
import * as assert from "assert";
import {
  assertNonAdminTestCase,
  GeneralTestCases,
} from "../bankrun-general-tests-helper";
import {
  closeAccount,
  createAndSetDaoFeeConfig,
  createAndSetFeeRecipients,
  createAndSetFolio,
} from "../bankrun-account-helper";
import { FolioAdmin } from "../../../target/types/folio_admin";
import { MAX_DAO_FEE, MAX_FEE_FLOOR } from "../../../utils/constants";
import { getOrCreateAtaAddress, initToken } from "../bankrun-token-helper";
import { Folio } from "../../../target/types/folio";

/**
 * Tests for DAO fee configuration functionality, including:
 * - Setting and updating DAO-wide fee configurations
 * - Setting and updating folio-specific fee configurations
 * - Fee numerator and floor validation
 * - Fee recipient validation
 * - Admin permission checks
 */

describe("Bankrun - Dao / Folio Fee Config", () => {
  let context: ProgramTestContext;
  let provider: BankrunProvider;
  let banksClient: BanksClient;

  let programFolioAdmin: Program<FolioAdmin>;
  let programFolio: Program<Folio>;

  let keys: any;

  let payerKeypair: Keypair;
  let adminKeypair: Keypair;

  let folioPDA: PublicKey;
  const FOLIO_TOKEN_MINT: PublicKey = Keypair.generate().publicKey;

  let daoFeeConfigPDA: PublicKey;
  let folioFeeConfigPDA: PublicKey;

  const DEFAULT_PARAMS: {
    existsBefore: boolean;
    expectedFeeRecipient: PublicKey;
    expectedFeeNumerator: BN;
    expectedFeeFloor: BN;
  } = {
    existsBefore: false,
    expectedFeeRecipient: Keypair.generate().publicKey,
    expectedFeeNumerator: new BN(10),
    expectedFeeFloor: new BN(10),
  };

  const TEST_CASES_SET_DAO_FEE_CONFIG = [
    {
      desc: "(fee numerator too high)",
      getKeypair: () => adminKeypair,
      expectedError: "InvalidFeeNumerator",
      expectedFeeNumerator: MAX_DAO_FEE.add(new BN(1)),
    },
    {
      desc: "(fee floor too high)",
      getKeypair: () => adminKeypair,
      expectedError: "InvalidFeeFloor",
      expectedFeeFloor: MAX_FEE_FLOOR.add(new BN(1)),
    },
    {
      desc: "(admin and init)",
      getKeypair: () => adminKeypair,
      expectedError: null,
      expectedFeeNumerator: new BN(10),
    },
    {
      desc: "(admin and update)",
      getKeypair: () => adminKeypair,
      expectedError: null,
      existsBefore: true,
      expectedFeeNumerator: new BN(20),
    },
  ];

  const TEST_CASES_SET_FOLIO_FEE_CONFIG = [
    {
      desc: "(fee numerator too high)",
      getKeypair: () => adminKeypair,
      expectedError: "InvalidFeeNumerator",
      expectedFeeNumerator: MAX_DAO_FEE.add(new BN(1)),
    },
    {
      desc: "(fee floor too high)",
      getKeypair: () => adminKeypair,
      expectedError: "InvalidFeeFloor",
      expectedFeeFloor: MAX_FEE_FLOOR.add(new BN(1)),
    },
    {
      desc: "(admin and init)",
      getKeypair: () => adminKeypair,
      expectedError: null,
      expectedFeeNumerator: new BN(10),
    },
    {
      desc: "(admin and update)",
      getKeypair: () => adminKeypair,
      expectedError: null,
      existsBefore: true,
      expectedFeeNumerator: new BN(20),
    },
  ];

  before(async () => {
    ({ keys, programFolioAdmin, programFolio, provider, context } =
      await getConnectors());

    banksClient = context.banksClient;

    payerKeypair = provider.wallet.payer;

    adminKeypair = Keypair.fromSecretKey(Uint8Array.from(keys.admin));

    await airdrop(context, payerKeypair.publicKey, 1000);
    await airdrop(context, adminKeypair.publicKey, 1000);

    folioPDA = getFolioPDA(FOLIO_TOKEN_MINT);

    // Create token for folio token mint
    initToken(context, folioPDA, FOLIO_TOKEN_MINT);

    daoFeeConfigPDA = getDAOFeeConfigPDA();

    folioFeeConfigPDA = getFolioFeeConfigPDA(folioPDA);
  });

  describe("General Tests", () => {
    const generalIxSetDaoFeeConfig = () =>
      setDaoFeeConfig<false>(
        banksClient,
        programFolioAdmin,
        adminKeypair,
        DEFAULT_PARAMS.expectedFeeRecipient,
        DEFAULT_PARAMS.expectedFeeNumerator,
        DEFAULT_PARAMS.expectedFeeFloor,
        false
      );

    const generalIxSetFolioFeeConfig = () =>
      setFolioFeeConfig<false>(
        banksClient,
        programFolioAdmin,
        adminKeypair,
        folioPDA,
        FOLIO_TOKEN_MINT,
        DEFAULT_PARAMS.expectedFeeNumerator,
        DEFAULT_PARAMS.expectedFeeFloor,
        DEFAULT_PARAMS.expectedFeeRecipient,
        false
      );

    describe("General Tests for Set DAO Fee Config", () => {
      it(`should run ${GeneralTestCases.NotAdmin}`, async () => {
        await assertNonAdminTestCase(context, generalIxSetDaoFeeConfig);
      });
    });

    describe("General Tests for Set Folio Fee Config", () => {
      before(async () => {
        await createAndSetDaoFeeConfig(
          context,
          programFolioAdmin,
          DEFAULT_PARAMS.expectedFeeRecipient,
          DEFAULT_PARAMS.expectedFeeNumerator
        );
      });

      it(`should run ${GeneralTestCases.NotAdmin}`, async () => {
        await assertNonAdminTestCase(context, generalIxSetFolioFeeConfig);
      });
    });
  });

  describe("Specific Cases - Set DAO Fee Config", () => {
    TEST_CASES_SET_DAO_FEE_CONFIG.forEach(
      ({ desc, expectedError, getKeypair, ...restOfParams }) => {
        describe(`When ${desc}`, () => {
          const {
            existsBefore,
            expectedFeeRecipient,
            expectedFeeNumerator,
            expectedFeeFloor,
          } = {
            ...DEFAULT_PARAMS,
            ...restOfParams,
          };

          let txnResult: BanksTransactionResultWithMeta;

          before(async () => {
            if (existsBefore) {
              await createAndSetDaoFeeConfig(
                context,
                programFolioAdmin,
                expectedFeeRecipient,
                expectedFeeNumerator
              );
              await travelFutureSlot(context);
            }

            txnResult = await setDaoFeeConfig<true>(
              banksClient,
              programFolioAdmin,
              getKeypair(),
              expectedFeeRecipient,
              expectedFeeNumerator,
              expectedFeeFloor
            );
          });

          if (expectedError) {
            it("should fail with expected error", () => {
              assertError(txnResult, expectedError);
            });
          } else {
            it("should succeed", async () => {
              await travelFutureSlot(context);

              const daoFeeConfig =
                await programFolioAdmin.account.daoFeeConfig.fetch(
                  daoFeeConfigPDA
                );
              assert.equal(
                daoFeeConfig.feeRecipient.toBase58(),
                expectedFeeRecipient.toBase58()
              );
              assert.equal(
                daoFeeConfig.defaultFeeNumerator.toString(),
                expectedFeeNumerator.toString()
              );
            });
          }
        });
      }
    );
  });

  describe("Specific Cases - Set Folio Fee Config", () => {
    TEST_CASES_SET_FOLIO_FEE_CONFIG.forEach(
      ({ desc, expectedError, getKeypair, ...restOfParams }) => {
        describe(`When ${desc}`, () => {
          const {
            expectedFeeRecipient,
            expectedFeeNumerator,
            expectedFeeFloor,
          } = {
            ...DEFAULT_PARAMS,
            ...restOfParams,
          };

          let txnResult: BanksTransactionResultWithMeta;

          before(async () => {
            await airdrop(context, expectedFeeRecipient, 1000);

            await createAndSetDaoFeeConfig(
              context,
              programFolioAdmin,
              expectedFeeRecipient,
              expectedFeeNumerator
            );

            await createAndSetFeeRecipients(
              context,
              programFolio,
              folioPDA,
              []
            );

            await createAndSetFolio(context, programFolio, FOLIO_TOKEN_MINT);

            await closeAccount(
              context,
              getFeeDistributionPDA(folioPDA, new BN(1))
            );

            await travelFutureSlot(context);

            txnResult = await setFolioFeeConfig<true>(
              banksClient,
              programFolioAdmin,
              getKeypair(),
              folioPDA,
              FOLIO_TOKEN_MINT,
              expectedFeeNumerator,
              expectedFeeFloor,
              await getOrCreateAtaAddress(
                context,
                FOLIO_TOKEN_MINT,
                expectedFeeRecipient
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

              const folioFeeConfig =
                await programFolioAdmin.account.folioFeeConfig.fetch(
                  folioFeeConfigPDA
                );
              assert.equal(
                folioFeeConfig.feeNumerator.eq(expectedFeeNumerator),
                true
              );
              assert.equal(folioFeeConfig.feeFloor.eq(expectedFeeFloor), true);
            });
          }
        });
      }
    );
  });
});
