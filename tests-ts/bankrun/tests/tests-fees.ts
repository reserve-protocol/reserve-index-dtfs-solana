import { BN, Program, Provider } from "@coral-xyz/anchor";
import { AccountMeta, Keypair, PublicKey } from "@solana/web3.js";

import {
  createAndSetActor,
  createAndSetFolio,
  FolioStatus,
  createAndSetDaoFeeConfig,
  createAndSetFeeRecipients,
  createAndSetFeeDistribution,
  FeeRecipient,
  createAndSetFolioFeeConfig,
  closeAccount,
} from "../bankrun-account-helper";
import { Folio } from "../../../target/types/folio";
import { FolioAdmin } from "../../../target/types/folio_admin";
import {
  D18,
  D9,
  DAY_IN_SECONDS,
  DEFAULT_DECIMALS,
  MAX_MINT_FEE,
  TOTAL_PORTION_FEE_RECIPIENT,
} from "../../../utils/constants";
import {
  getAtaAddress,
  getOrCreateAtaAddress,
  getTokenBalance,
  initToken,
  resetTokenBalance,
} from "../bankrun-token-helper";
import { createAndSetFolioBasket, Role } from "../bankrun-account-helper";
import {
  airdrop,
  assertError,
  assertPreTransactionError,
  BanksTransactionResultWithMeta,
  getConnectors,
  travelFutureSlot,
} from "../bankrun-program-helper";
import {
  getFeeDistributionPDA,
  getTVLFeeRecipientsPDA,
  getFolioPDA,
  getFolioFeeConfigPDA,
} from "../../../utils/pda-helper";
import {
  crankFeeDistribution,
  distributeFees,
  pokeFolio,
} from "../bankrun-ix-helper";
import {
  assertInvalidFolioStatusTestCase,
  GeneralTestCases,
} from "../bankrun-general-tests-helper";
import * as assert from "assert";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Clock, LiteSVM } from "litesvm";
import { TestHelper } from "../../../utils/test-helper";

/**
 * Tests for fee-related functionality in the Folio program, including:
 * - Fee distribution to recipients
 * - Fee accrual and calculation
 * - Cranking fee distributions
 * - Fee recipient management
 * - Pending fee shares tracking
 */

describe("Bankrun - Fees", () => {
  let context: LiteSVM;
  let provider: Provider;
  let banksClient: LiteSVM;

  let programFolioAdmin: Program<FolioAdmin>;
  let programFolio: Program<Folio>;

  let keys: any;

  let payerKeypair: Keypair;
  let adminKeypair: Keypair;

  let folioOwnerKeypair: Keypair;
  let folioTokenMint: Keypair;
  let folioPDA: PublicKey;

  const feeRecipient1: Keypair = Keypair.generate();
  const feeRecipient2: Keypair = Keypair.generate();
  const feeRecipient3: Keypair = Keypair.generate();
  const feeRecipient4: Keypair = Keypair.generate();

  const feeRecipient: Keypair = Keypair.generate();
  const cranker: Keypair = Keypair.generate();

  let userKeypair: Keypair;

  const DEFAULT_PARAMS: {
    remainingAccounts: () => AccountMeta[];
    customFolioTokenMint: Keypair | null;
    index: BN;

    initialDaoPendingFeeShares: BN;
    initialFeeRecipientPendingFeeShares: BN;
    initialFeeDistributionIndex: BN;

    alreadyDistributedFeeRecipients: string[];

    // Is Validated before sending the transaction
    isPreTransactionValidated: boolean;

    /*
    For simplicity's sake, to test folio fee config, we will change the dao fee config current values, but use them
    to set the folio fee config. Therefore nothing fancy needs to be done to assert changes.
    */
    customFolioFeeConfig: boolean;

    addedClockTime: number;

    feeDistributionIndex: BN;

    daoFeeRecipient: Keypair;

    feeRecipients: FeeRecipient[];

    // To test when fully claimed vs not fully claimed, for close account
    feeRecipientNotClaiming: FeeRecipient[];

    // To test when a user tries to claim but he's not part of the recipients
    feeRecipientsToDistributeTo: FeeRecipient[];

    amountToDistribute: BN;

    customCranker: Keypair;

    // To test when the account should be closed
    shouldCloseAccount: boolean;

    // Expected changes
    expectedFolioTokenBalanceChange: BN;
    expectedDaoFeeShares: BN;
    expectedFeeRecipientShares: BN;

    expectedFeeDistributed: BN[];

    startUnixTimestamp: BN | null;
    useToken2022ForFolioTokenMint: boolean;
  } = {
    remainingAccounts: () => [],
    customFolioTokenMint: null,
    index: new BN(0),

    initialDaoPendingFeeShares: new BN(0),
    initialFeeRecipientPendingFeeShares: new BN(0),
    initialFeeDistributionIndex: new BN(0),

    alreadyDistributedFeeRecipients: [],
    feeRecipientsToDistributeTo: [],

    // Is Validated before sending the transaction
    isPreTransactionValidated: false,

    customFolioFeeConfig: false,

    addedClockTime: 0,

    feeDistributionIndex: new BN(1),

    daoFeeRecipient: null,

    feeRecipients: [],

    feeRecipientNotClaiming: [],

    amountToDistribute: new BN(0),

    customCranker: null,

    shouldCloseAccount: false,

    // Expected changes
    expectedFolioTokenBalanceChange: new BN(0),
    expectedDaoFeeShares: new BN(0),
    expectedFeeRecipientShares: new BN(0),

    expectedFeeDistributed: [],

    startUnixTimestamp: null,
    useToken2022ForFolioTokenMint: false,
  };

  const TEST_CASES_POKE_FOLIO = [
    {
      desc: "(folio token mint is not valid)",
      expectedError: "InvalidFolioTokenMint",
      customFolioTokenMint: Keypair.generate(),
    },
    {
      desc: "(current time is same as last poke, no changes)",
      expectedError: null,
      expectedDaoFeeShares: new BN(0),
      expectedFeeRecipientShares: new BN(0),
    },
    {
      desc: "(current time is 10 seconds after last poke, no change, as we are in same day)",
      expectedError: null,
      expectedDaoFeeShares: new BN(0), // In D18
      expectedFeeRecipientShares: new BN(0), // In D18
      addedClockTime: 10,
      // Required as otherwise the test will become flaky
      // They will fail if current time is just 10 seconds before the end of the day.
      startUnixTimestamp: new BN(1714003200),
    },
    {
      desc: "(current time is 1 day - 100 seconds after last poke , no change, as we are in same day)",
      expectedError: null,
      expectedDaoFeeShares: new BN(0), // In D18
      expectedFeeRecipientShares: new BN(0), // In D18
      addedClockTime: 86400 - 100,
      startUnixTimestamp: new BN(1714003200),
    },
    {
      desc: "(current time is one day after last poke, succeeds)",
      expectedError: null,
      expectedDaoFeeShares: new BN("14408468327699472"),
      expectedFeeRecipientShares: new BN("273760898226289967"),
      addedClockTime: 86400,
      initialDaoPendingFeeShares: new BN(1000),
      initialFeeRecipientPendingFeeShares: new BN(2000),
    },
    {
      desc: "(current time is 2 and 1 second after last poke, succeeds)",
      expectedError: null,
      expectedDaoFeeShares: new BN("28821088734589935"),
      expectedFeeRecipientShares: new BN("547600685957208750"),
      addedClockTime: 86400 * 2 + 1,
      customFolioFeeConfig: true,
    },
  ];

  const TEST_CASES_DISTRIBUTE_FEES = [
    {
      desc: "(index is not valid)",
      expectedError: "InvalidDistributionIndex",
      feeDistributionIndex: new BN(2),
    },
    {
      desc: "(folio token mint is not valid)",
      expectedError: "InvalidFolioTokenMint",
      customFolioTokenMint: Keypair.generate(),
    },
    {
      desc: "(dao fee recipient is not valid, errors out)",
      expectedError: "InvalidDaoFeeRecipient",
      daoFeeRecipient: Keypair.generate(),
    },
    {
      desc: "(is valid, succeeds)",
      expectedError: null,
      initialDaoPendingFeeShares: new BN(1000).mul(D18),
      // D9 as this is token amounts
      expectedDaoFeeShares: new BN(1000).mul(D9),
      customFolioFeeConfig: true,
    },
    {
      desc: "(is valid, succeeds)",
      expectedError: null,
      initialDaoPendingFeeShares: new BN(1000).mul(D18),
      // D9 as this is token amounts
      expectedDaoFeeShares: new BN(1000).mul(D9),
      useToken2022ForFolioTokenMint: true,
    },
    {
      desc: "(is valid, if no fee recipients are present and folio still has raw_fee_recipients_pending_fee_shares, succeeds)",
      expectedError: null,
      initialDaoPendingFeeShares: new BN(1000).mul(D18),
      initialFeeRecipientPendingFeeShares: new BN(1000).mul(D18),
      // D9 as this is token amounts
      expectedDaoFeeShares: new BN(2000).mul(D9),
      expectedFeeRecipientShares: new BN(0),
      useToken2022ForFolioTokenMint: false,
    },
  ];

  const TEST_CASES_CRANK_FEE_DISTRIBUTION = [
    {
      desc: "(invalid folio token mint)",
      expectedError: "InvalidFolioTokenMint",
      customFolioTokenMint: Keypair.generate(),
    },
    {
      desc: "(cranker is not valid)",
      expectedError: "InvalidCranker",
      customCranker: Keypair.generate(),
    },
    {
      desc: "(user tries to distribute fees to too many users, transaction size issue, errors out)",
      expectedError: "TransactionTooLarge",
      feeRecipients: Array.from({ length: 30 }, () => ({
        recipient: Keypair.generate().publicKey,
        portion: TOTAL_PORTION_FEE_RECIPIENT.div(new BN(30)),
      })),
      feeRecipientsToDistributeTo: Array.from({ length: 30 }, () => ({
        recipient: Keypair.generate().publicKey,
        portion: TOTAL_PORTION_FEE_RECIPIENT.div(new BN(30)),
      })),
      isPreTransactionValidated: true,
    },
    {
      desc: "(user tries to distribute fees to a user that has already been distributed to, succeeds but no changes)",
      expectedError: null,
      amountToDistribute: new BN(8_000_000_000).mul(D9),
      alreadyDistributedFeeRecipients: [feeRecipient1.publicKey.toBase58()],
      feeRecipients: [
        {
          recipient: feeRecipient1.publicKey,
          portion: TOTAL_PORTION_FEE_RECIPIENT.div(new BN(2)),
        },
        {
          recipient: feeRecipient2.publicKey,
          portion: TOTAL_PORTION_FEE_RECIPIENT.div(new BN(2)),
        },
      ],
      feeRecipientNotClaiming: [
        {
          recipient: feeRecipient3.publicKey,
          portion: TOTAL_PORTION_FEE_RECIPIENT.div(new BN(2)),
        },
      ],
      feeRecipientsToDistributeTo: [
        {
          recipient: feeRecipient1.publicKey,
          portion: TOTAL_PORTION_FEE_RECIPIENT.div(new BN(2)),
        },
        {
          recipient: feeRecipient2.publicKey,
          portion: TOTAL_PORTION_FEE_RECIPIENT.div(new BN(2)),
        },
      ],
      // 0 Because already distributed
      expectedFeeDistributed: [new BN(0), new BN(4_000_000_000)],
    },
    {
      desc: "(user tries to distribute fees to a non fee recipient, errors out)",
      expectedError: "InvalidFeeRecipient",
      // Stored in D18
      amountToDistribute: new BN(8_000_000_000).mul(D9),
      feeRecipients: [
        {
          recipient: feeRecipient1.publicKey,
          portion: TOTAL_PORTION_FEE_RECIPIENT.div(new BN(2)),
        },
        {
          recipient: feeRecipient2.publicKey,
          portion: TOTAL_PORTION_FEE_RECIPIENT.div(new BN(2)),
        },
      ],
      feeRecipientsToDistributeTo: [
        {
          recipient: feeRecipient1.publicKey,
          portion: TOTAL_PORTION_FEE_RECIPIENT.div(new BN(2)),
        },
        {
          recipient: feeRecipient3.publicKey,
          portion: TOTAL_PORTION_FEE_RECIPIENT.div(new BN(2)),
        },
      ],
    },
    {
      desc: "(user distribute fees to only a partial number of fee recipients, account doesn't close)",
      expectedError: null,
      amountToDistribute: new BN(8_000_000_000).mul(D9),
      feeRecipients: [
        {
          recipient: feeRecipient1.publicKey,
          portion: TOTAL_PORTION_FEE_RECIPIENT.div(new BN(2)),
        },
        {
          recipient: feeRecipient2.publicKey,
          portion: TOTAL_PORTION_FEE_RECIPIENT.div(new BN(2)),
        },
      ],
      feeRecipientNotClaiming: [
        {
          recipient: feeRecipient2.publicKey,
          portion: TOTAL_PORTION_FEE_RECIPIENT.div(new BN(2)),
        },
      ],
      feeRecipientsToDistributeTo: [
        {
          recipient: feeRecipient1.publicKey,
          portion: TOTAL_PORTION_FEE_RECIPIENT.div(new BN(2)),
        },
      ],
      expectedFeeDistributed: [new BN(4_000_000_000)],
    },
    {
      desc: "(user distributes fees to all fee recipients, account closes)",
      expectedError: null,
      amountToDistribute: new BN(8_000_000_000).mul(D9),
      feeRecipients: [
        {
          recipient: feeRecipient1.publicKey,
          portion: TOTAL_PORTION_FEE_RECIPIENT.div(new BN(2)),
        },
        {
          recipient: feeRecipient2.publicKey,
          portion: TOTAL_PORTION_FEE_RECIPIENT.div(new BN(2)),
        },
      ],
      feeRecipientNotClaiming: [],
      feeRecipientsToDistributeTo: [
        {
          recipient: feeRecipient1.publicKey,
          portion: TOTAL_PORTION_FEE_RECIPIENT.div(new BN(2)),
        },
        {
          recipient: feeRecipient2.publicKey,
          portion: TOTAL_PORTION_FEE_RECIPIENT.div(new BN(2)),
        },
      ],
      expectedFeeDistributed: [new BN(4_000_000_000), new BN(4_000_000_000)],
      shouldCloseAccount: true,
    },
    {
      desc: "(user distributes fees to all fee recipients, account closes, with token 2022)",
      expectedError: null,
      amountToDistribute: new BN(8_000_000_000).mul(D9),
      useToken2022ForFolioTokenMint: true,
      feeRecipients: [
        {
          recipient: feeRecipient1.publicKey,
          portion: TOTAL_PORTION_FEE_RECIPIENT.div(new BN(2)),
        },
        {
          recipient: feeRecipient2.publicKey,
          portion: TOTAL_PORTION_FEE_RECIPIENT.div(new BN(2)),
        },
      ],
      feeRecipientNotClaiming: [],
      feeRecipientsToDistributeTo: [
        {
          recipient: feeRecipient1.publicKey,
          portion: TOTAL_PORTION_FEE_RECIPIENT.div(new BN(2)),
        },
        {
          recipient: feeRecipient2.publicKey,
          portion: TOTAL_PORTION_FEE_RECIPIENT.div(new BN(2)),
        },
      ],
      expectedFeeDistributed: [new BN(4_000_000_000), new BN(4_000_000_000)],
      shouldCloseAccount: true,
    },
  ];

  async function setFeeRegistry(customFolioFeeConfig: boolean) {
    if (customFolioFeeConfig) {
      // So we set worng values on dao fee config, but use them to set the folio fee config
      await createAndSetDaoFeeConfig(
        context,
        programFolioAdmin,
        feeRecipient.publicKey,
        new BN(0),
        new BN(0)
      );

      await createAndSetFolioFeeConfig(
        context,
        programFolioAdmin,
        folioPDA,
        MAX_MINT_FEE
      );
    } else {
      await createAndSetDaoFeeConfig(
        context,
        programFolioAdmin,
        feeRecipient.publicKey,
        MAX_MINT_FEE
      );
      await closeAccount(context, getFolioFeeConfigPDA(folioPDA));
    }
  }

  async function initBaseCase(
    customFolioTokenMint: Keypair | null = null,
    customFolioTokenSupply: BN = new BN(0),
    customFolioFeeConfig: boolean = false,
    amountToDistribute: BN = new BN(0),
    useToken2022ForFolioTokenMint: boolean = false
  ) {
    await setFeeRegistry(customFolioFeeConfig);

    await createAndSetFolio(
      context,
      programFolio,
      folioTokenMint.publicKey,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      undefined,
      amountToDistribute
    );

    initToken(
      context,
      folioPDA,
      folioTokenMint,
      DEFAULT_DECIMALS,
      customFolioTokenSupply,
      useToken2022ForFolioTokenMint ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID
    );

    if (customFolioTokenMint) {
      initToken(context, folioPDA, customFolioTokenMint, DEFAULT_DECIMALS);

      await getOrCreateAtaAddress(
        context,
        customFolioTokenMint.publicKey,
        feeRecipient.publicKey,
        useToken2022ForFolioTokenMint ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID
      );
    }

    await getOrCreateAtaAddress(
      context,
      folioTokenMint.publicKey,
      feeRecipient.publicKey,
      useToken2022ForFolioTokenMint ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID
    );

    await createAndSetActor(
      context,
      programFolio,
      folioOwnerKeypair,
      folioPDA,
      Role.Owner
    );

    await createAndSetFolioBasket(context, programFolio, folioPDA, []);

    await createAndSetFeeRecipients(context, programFolio, folioPDA, []);

    // Reset token balance for clean slate
    for (const feeRecipient of [
      feeRecipient1,
      feeRecipient2,
      feeRecipient3,
      feeRecipient4,
    ]) {
      await resetTokenBalance(
        context,
        folioTokenMint.publicKey,
        feeRecipient.publicKey
      );
    }
  }

  beforeEach(async () => {
    ({ keys, programFolioAdmin, programFolio, provider, context } =
      await getConnectors());

    banksClient = context;

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
    const generalIxPokeFolio = () =>
      pokeFolio<true>(
        banksClient,
        programFolio,
        userKeypair,
        folioPDA,
        folioTokenMint.publicKey,
        true
      );

    const generalIxDistributeFees = () =>
      distributeFees<true>(
        banksClient,
        programFolio,
        userKeypair,
        folioPDA,
        folioTokenMint.publicKey,
        getAtaAddress(folioTokenMint.publicKey, feeRecipient.publicKey),
        new BN(0),
        true
      );

    const generalIxCrankFeeDistribution = () =>
      crankFeeDistribution<true>(
        banksClient,
        programFolio,
        userKeypair,
        folioPDA,
        folioTokenMint.publicKey,
        adminKeypair.publicKey,
        new BN(0),
        [],
        [],
        true
      );

    beforeEach(async () => {
      await initBaseCase();
    });

    describe("should run general tests for poke folio", () => {
      it(`should run ${GeneralTestCases.InvalidFolioStatus} for both INITIALIZING and MIGRATING`, async () => {
        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,
          generalIxPokeFolio,
          FolioStatus.Initializing
        );

        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,
          generalIxPokeFolio,
          FolioStatus.Migrating
        );
      });
    });

    describe("should run general tests for distribute fees", () => {
      it(`should run ${GeneralTestCases.InvalidFolioStatus} for INITIALIZING & MIGRATING`, async () => {
        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,
          generalIxDistributeFees,
          FolioStatus.Initializing
        );

        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,
          generalIxDistributeFees,
          FolioStatus.Migrating
        );
      });
    });

    describe("should run general tests for crank fee distribution", () => {
      beforeEach(async () => {
        await createAndSetFeeDistribution(
          context,
          programFolio,
          folioPDA,
          adminKeypair.publicKey,
          new BN(0),
          new BN(0),
          []
        );
      });

      it(`should run ${GeneralTestCases.InvalidFolioStatus} for INITIALIZING & MIGRATING`, async () => {
        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,
          generalIxCrankFeeDistribution,
          FolioStatus.Initializing
        );

        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,
          generalIxCrankFeeDistribution,
          FolioStatus.Migrating
        );
      });
    });
  });

  describe("Specific Cases - Poke Folio", () => {
    TEST_CASES_POKE_FOLIO.forEach(
      ({ desc, expectedError, ...restOfParams }) => {
        describe(`When ${desc}`, () => {
          let txnResult: BanksTransactionResultWithMeta;
          const {
            expectedDaoFeeShares,
            expectedFeeRecipientShares,
            customFolioTokenMint,
            addedClockTime,
            initialDaoPendingFeeShares,
            initialFeeRecipientPendingFeeShares,
            customFolioFeeConfig,
            startUnixTimestamp,
          } = {
            ...DEFAULT_PARAMS,
            ...restOfParams,
          };

          let folioBefore: any;
          let currentClock: Clock;
          let unixTimestamp: bigint;

          beforeEach(async () => {
            await initBaseCase(
              customFolioTokenMint,
              new BN(1000_000_000_000),
              customFolioFeeConfig
            );

            currentClock = await context.getClock();
            let currentUnixTimestamp = currentClock.unixTimestamp;
            if (startUnixTimestamp) {
              currentUnixTimestamp = BigInt(startUnixTimestamp.toString());
            }

            const endOfCurrentDay =
              (currentUnixTimestamp / BigInt(DAY_IN_SECONDS)) *
              BigInt(DAY_IN_SECONDS);
            await createAndSetFolio(
              context,
              programFolio,
              folioTokenMint.publicKey,
              undefined,
              undefined,
              // Set as end of current day
              new BN(endOfCurrentDay.toString()),
              initialDaoPendingFeeShares,
              initialFeeRecipientPendingFeeShares
            );

            await travelFutureSlot(context);

            const tokenMintToUse = customFolioTokenMint || folioTokenMint;
            folioBefore = await programFolio.account.folio.fetch(folioPDA);

            unixTimestamp = currentUnixTimestamp + BigInt(addedClockTime);
            context.setClock(
              new Clock(
                currentClock.slot,
                currentClock.epochStartTimestamp,
                currentClock.epoch,
                currentClock.leaderScheduleEpoch,
                unixTimestamp
              )
            );

            txnResult = await pokeFolio<true>(
              banksClient,
              programFolio,
              userKeypair,
              folioPDA,
              tokenMintToUse.publicKey,
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

              // Folio should have updated fees
              const folio = await programFolio.account.folio.fetch(folioPDA);
              assert.equal(
                folio.daoPendingFeeShares.eq(
                  folioBefore.daoPendingFeeShares.add(expectedDaoFeeShares)
                ),
                true
              );
              assert.equal(
                folio.feeRecipientsPendingFeeShares.eq(
                  folioBefore.feeRecipientsPendingFeeShares.add(
                    expectedFeeRecipientShares
                  )
                ),
                true
              );

              if (folio.daoPendingFeeShares.gt(new BN(0))) {
                const endOfDay =
                  (unixTimestamp / BigInt(DAY_IN_SECONDS)) *
                  BigInt(DAY_IN_SECONDS);
                assert.equal(folio.lastPoke.toString(), endOfDay.toString());
              } else {
                assert.equal(
                  folio.lastPoke.toString(),
                  folioBefore.lastPoke.toString()
                );
              }
            });
          }
        });
      }
    );
  });

  describe("Specific Cases - Distribute fees", () => {
    TEST_CASES_DISTRIBUTE_FEES.forEach(
      ({ desc, expectedError, ...restOfParams }) => {
        describe(`When ${desc}`, () => {
          let txnResult: BanksTransactionResultWithMeta;
          const {
            expectedDaoFeeShares,
            customFolioTokenMint,
            initialDaoPendingFeeShares,
            initialFeeRecipientPendingFeeShares,
            daoFeeRecipient,
            feeDistributionIndex,
            initialFeeDistributionIndex,
            customFolioFeeConfig,
            useToken2022ForFolioTokenMint,
          } = {
            ...DEFAULT_PARAMS,
            ...restOfParams,
          };

          const daoFeeRecipientToUse = daoFeeRecipient || feeRecipient;

          let feeRecipientBefore: any;
          let daoFeeRecipientBalanceBefore: bigint;
          let currentClock: Clock;

          beforeEach(async () => {
            await initBaseCase(
              customFolioTokenMint,
              new BN(1000_000_000_000),
              customFolioFeeConfig,
              undefined,
              useToken2022ForFolioTokenMint
            );

            currentClock = await context.getClock();

            await createAndSetFolio(
              context,
              programFolio,
              folioTokenMint.publicKey,

              undefined,
              undefined,
              new BN(currentClock.unixTimestamp.toString()),
              initialDaoPendingFeeShares,
              initialFeeRecipientPendingFeeShares
            );

            await createAndSetFeeRecipients(
              context,
              programFolio,
              folioPDA,
              [],
              initialFeeDistributionIndex
            );

            await travelFutureSlot(context);

            feeRecipientBefore = await programFolio.account.feeRecipients.fetch(
              getTVLFeeRecipientsPDA(folioPDA)
            );

            const tokenMintToUse = customFolioTokenMint || folioTokenMint;

            daoFeeRecipientBalanceBefore = await getTokenBalance(
              banksClient,
              await getOrCreateAtaAddress(
                context,
                tokenMintToUse.publicKey,
                daoFeeRecipientToUse.publicKey,
                useToken2022ForFolioTokenMint
                  ? TOKEN_2022_PROGRAM_ID
                  : TOKEN_PROGRAM_ID
              )
            );

            txnResult = await distributeFees<true>(
              banksClient,
              programFolio,
              userKeypair,
              folioPDA,
              tokenMintToUse.publicKey,
              await getOrCreateAtaAddress(
                context,
                tokenMintToUse.publicKey,
                daoFeeRecipientToUse.publicKey,
                useToken2022ForFolioTokenMint
                  ? TOKEN_2022_PROGRAM_ID
                  : TOKEN_PROGRAM_ID
              ),
              feeDistributionIndex,

              true,
              useToken2022ForFolioTokenMint
                ? TOKEN_2022_PROGRAM_ID
                : TOKEN_PROGRAM_ID
            );
          });

          if (expectedError) {
            it("should fail with expected error", () => {
              assertError(txnResult, expectedError);
            });
          } else {
            it("should succeed", async () => {
              await travelFutureSlot(context);

              // Folio should have updated fees to 0, since distributed
              const folio = await programFolio.account.folio.fetch(folioPDA);
              assert.equal(folio.daoPendingFeeShares.eq(new BN(0)), true);
              assert.equal(
                folio.feeRecipientsPendingFeeShares.eq(new BN(0)),
                true
              );

              // Fee Recipient index should have been updated
              const feeRecipientAfter =
                await programFolio.account.feeRecipients.fetch(
                  getTVLFeeRecipientsPDA(folioPDA)
                );
              assert.equal(
                feeRecipientAfter.distributionIndex.eq(
                  feeRecipientBefore.distributionIndex.add(feeDistributionIndex)
                ),
                true
              );

              // Balance for the dao fee recipient should be updated
              const daoFeeRecipientBalanceAfter = await getTokenBalance(
                banksClient,
                getAtaAddress(
                  folioTokenMint.publicKey,
                  daoFeeRecipientToUse.publicKey,
                  useToken2022ForFolioTokenMint
                    ? TOKEN_2022_PROGRAM_ID
                    : TOKEN_PROGRAM_ID
                )
              );
              assert.equal(
                daoFeeRecipientBalanceAfter ==
                  daoFeeRecipientBalanceBefore +
                    BigInt(expectedDaoFeeShares.toString()),
                true
              );
            });
          }
        });
      }
    );
  });

  describe("Specific Cases - Crank fee distribution", () => {
    TEST_CASES_CRANK_FEE_DISTRIBUTION.forEach(
      ({ desc, expectedError, ...restOfParams }) => {
        describe(`When ${desc}`, () => {
          let txnResult: BanksTransactionResultWithMeta;
          const {
            customFolioTokenMint,
            initialFeeRecipientPendingFeeShares,
            alreadyDistributedFeeRecipients,
            feeDistributionIndex,
            feeRecipients,
            amountToDistribute,
            customCranker,
            isPreTransactionValidated,
            expectedFeeDistributed,
            feeRecipientNotClaiming,
            feeRecipientsToDistributeTo,
            shouldCloseAccount,
            useToken2022ForFolioTokenMint,
          } = {
            ...DEFAULT_PARAMS,
            ...restOfParams,
          };

          const feeRecipientsATA = [];
          const feeRecipientsBalancesBefore = [];

          let currentClock: Clock;
          let preTxnError: any;

          const crankerToUse = customCranker || cranker;

          let folioBefore: any;

          beforeEach(async () => {
            await initBaseCase(
              customFolioTokenMint,
              new BN(1000_000_000_000),
              undefined,
              amountToDistribute,
              useToken2022ForFolioTokenMint
            );

            currentClock = await context.getClock();

            // Get the ATAs for the fee recipients we want to send to the instruction
            for (const feeRecipient of feeRecipientsToDistributeTo) {
              const feeRecipientATA = await getOrCreateAtaAddress(
                context,
                folioTokenMint.publicKey,
                feeRecipient.recipient,
                useToken2022ForFolioTokenMint
                  ? TOKEN_2022_PROGRAM_ID
                  : TOKEN_PROGRAM_ID
              );
              feeRecipientsATA.push(feeRecipientATA);
              feeRecipientsBalancesBefore.push(
                await getTokenBalance(banksClient, feeRecipientATA)
              );
            }

            await createAndSetFolio(
              context,
              programFolio,
              folioTokenMint.publicKey,
              undefined,
              undefined,
              new BN(currentClock.unixTimestamp.toString()),
              new BN(0),
              initialFeeRecipientPendingFeeShares,
              false,
              undefined,
              amountToDistribute
            );

            // Remove the fee recipients that were already claimed (by putting them as public key default)
            const feeRecipientsInDistribution = [
              ...feeRecipients,
              ...feeRecipientNotClaiming,
            ].map((f) => {
              if (
                alreadyDistributedFeeRecipients.includes(f.recipient.toBase58())
              ) {
                return {
                  ...f,
                  recipient: PublicKey.default,
                };
              }
              return f;
            });

            await createAndSetFeeDistribution(
              context,
              programFolio,
              folioPDA,
              cranker.publicKey,
              feeDistributionIndex,
              amountToDistribute,
              // Here we send the owner of the token acc (the owner = the recipient)
              feeRecipientsInDistribution
            );

            await travelFutureSlot(context);

            const tokenMintToUse = customFolioTokenMint || folioTokenMint;

            folioBefore = await programFolio.account.folio.fetch(folioPDA);

            try {
              txnResult = await crankFeeDistribution<true>(
                banksClient,
                programFolio,
                userKeypair,
                folioPDA,
                tokenMintToUse.publicKey,
                crankerToUse.publicKey,
                feeDistributionIndex,
                Array.from(
                  { length: feeRecipientsATA.length },
                  (_, i) => new BN(i)
                ),
                feeRecipientsATA,

                true,
                [],
                useToken2022ForFolioTokenMint
                  ? TOKEN_2022_PROGRAM_ID
                  : TOKEN_PROGRAM_ID
              );
            } catch (e) {
              preTxnError = e;
            }
          });

          if (isPreTransactionValidated) {
            it("should fail pre transaction validation", () => {
              assertPreTransactionError(preTxnError, expectedError);
            });
            return;
          }

          if (expectedError) {
            it("should fail with expected error", () => {
              assertError(txnResult, expectedError);
            });
          } else {
            it("should succeed", async () => {
              await travelFutureSlot(context);

              // If all the claiming is done, the account should be closed, so returns null
              if (shouldCloseAccount) {
                TestHelper.assertAccountIsClosed(
                  banksClient.getAccount(
                    getFeeDistributionPDA(folioPDA, feeDistributionIndex)
                  )
                );
              } else {
                // Else Fee Distribution should have been updated
                const feeDistributionAfter =
                  await programFolio.account.feeDistribution.fetch(
                    getFeeDistributionPDA(folioPDA, feeDistributionIndex)
                  );

                for (const feeRecipientState of feeDistributionAfter.feeRecipientsState) {
                  // Set to default when it's been distributed
                  const notDistributed = feeRecipientNotClaiming.find((f) =>
                    f.recipient.equals(feeRecipientState.recipient)
                  );
                  if (notDistributed) {
                    // If we haven't distributed then shouldn't be set as public key default
                    assert.deepEqual(
                      feeRecipientState.recipient,
                      notDistributed.recipient
                    );
                  } else {
                    assert.deepEqual(
                      feeRecipientState.recipient,
                      PublicKey.default
                    );
                  }
                }
              }

              // Assert balance changes
              for (let i = 0; i < feeRecipientsATA.length; i++) {
                const feeRecipientATA = feeRecipientsATA[i];
                const feeRecipientBalanceAfter = await getTokenBalance(
                  banksClient,
                  feeRecipientATA
                );

                assert.equal(
                  feeRecipientBalanceAfter ==
                    feeRecipientsBalancesBefore[i] + expectedFeeDistributed[i],
                  true
                );
              }

              const totalFeeDistributed = expectedFeeDistributed.reduce(
                (acc, curr) => acc.add(curr),
                new BN(0)
              );
              const folioAfter = await programFolio.account.folio.fetch(
                folioPDA
              );

              assert.equal(
                folioBefore.feeRecipientsPendingFeeSharesToBeMinted
                  .sub(totalFeeDistributed.mul(D9))
                  .eq(folioAfter.feeRecipientsPendingFeeSharesToBeMinted),
                true
              );
            });
          }
        });
      }
    );
  });
});
