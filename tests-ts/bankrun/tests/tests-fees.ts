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
  createAndSetFeeRecipients,
  createAndSetFeeDistribution,
  FeeRecipient,
} from "../bankrun-account-helper";
import { Folio } from "../../../target/types/folio";
import { FolioAdmin } from "../../../target/types/folio_admin";
import {
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
  getConnectors,
  travelFutureSlot,
} from "../bankrun-program-helper";
import {
  getFeeDistributionPDA,
  getTVLFeeRecipientsPDA,
  getFolioPDA,
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

describe("Bankrun - Fees", () => {
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
      desc: "(current time is after last poke 10 seconds, succeeds)",
      expectedError: null,
      expectedDaoFeeShares: new BN(142),
      expectedFeeRecipientShares: new BN(285246),
      addedClockTime: 10,
    },
    {
      desc: "(current time is after last poke 60 seconds, succeeds)",
      expectedError: null,
      expectedDaoFeeShares: new BN(856),
      expectedFeeRecipientShares: new BN(1_711_472),
      addedClockTime: 60,
      initialDaoPendingFeeShares: new BN(1000),
      initialFeeRecipientPendingFeeShares: new BN(2000),
    },
    {
      desc: "(current time is after last poke 3600 seconds, succeeds)",
      expectedError: null,
      expectedDaoFeeShares: new BN(51369),
      expectedFeeRecipientShares: new BN(102688357),
      addedClockTime: 3600,
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
      initialDaoPendingFeeShares: new BN(1000),
      expectedDaoFeeShares: new BN(1000),
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
      amountToDistribute: new BN(8_000_000_000),
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
      amountToDistribute: new BN(8_000_000_000),
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
      amountToDistribute: new BN(8_000_000_000),
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
      amountToDistribute: new BN(8_000_000_000),
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

    await createAndSetFolio(context, programFolio, folioTokenMint.publicKey);

    initToken(
      context,
      folioPDA,
      folioTokenMint,
      DEFAULT_DECIMALS,
      customFolioTokenSupply
    );

    if (customFolioTokenMint) {
      initToken(context, folioPDA, customFolioTokenMint, DEFAULT_DECIMALS);

      await getOrCreateAtaAddress(
        context,
        customFolioTokenMint.publicKey,

        feeRecipient.publicKey
      );
    }

    await getOrCreateAtaAddress(
      context,
      folioTokenMint.publicKey,
      feeRecipient.publicKey
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
      it(`should run ${GeneralTestCases.InvalidFolioStatus} for both KILLED and INITIALIZING and MIGRATING`, async () => {
        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,
          generalIxPokeFolio,
          FolioStatus.Killed
        );

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
      it(`should run ${GeneralTestCases.InvalidFolioStatus} for INITIALIZING & KILLED & MIGRATING`, async () => {
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
          FolioStatus.Killed
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

      it(`should run ${GeneralTestCases.InvalidFolioStatus} for both INITIALIZING`, async () => {
        await assertInvalidFolioStatusTestCase(
          context,
          programFolio,
          folioTokenMint.publicKey,
          generalIxCrankFeeDistribution,
          FolioStatus.Initializing
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
          } = {
            ...DEFAULT_PARAMS,
            ...restOfParams,
          };

          let folioBefore: any;
          let currentClock: Clock;

          before(async () => {
            await initBaseCase(customFolioTokenMint, new BN(1000_000_000_000));

            currentClock = await context.banksClient.getClock();

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

            await travelFutureSlot(context);

            const tokenMintToUse = customFolioTokenMint || folioTokenMint;

            folioBefore = await programFolio.account.folio.fetch(folioPDA);

            context.setClock(
              new Clock(
                currentClock.slot,
                currentClock.epochStartTimestamp,
                currentClock.epoch,
                currentClock.leaderScheduleEpoch,
                currentClock.unixTimestamp + BigInt(addedClockTime)
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
              assert.equal(
                folio.lastPoke,
                currentClock.unixTimestamp + BigInt(addedClockTime)
              );
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
          } = {
            ...DEFAULT_PARAMS,
            ...restOfParams,
          };

          const daoFeeRecipientToUse = daoFeeRecipient || feeRecipient;

          let feeRecipientBefore: any;
          let daoFeeRecipientBalanceBefore: bigint;
          let currentClock: Clock;

          before(async () => {
            await initBaseCase(customFolioTokenMint, new BN(1000_000_000_000));

            currentClock = await context.banksClient.getClock();

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
                daoFeeRecipientToUse.publicKey
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
                daoFeeRecipientToUse.publicKey
              ),
              feeDistributionIndex,

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
                  daoFeeRecipientToUse.publicKey
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
          } = {
            ...DEFAULT_PARAMS,
            ...restOfParams,
          };

          const feeRecipientsATA = [];
          const feeRecipientsBalancesBefore = [];

          let currentClock: Clock;
          let preTxnError: any;

          const crankerToUse = customCranker || cranker;

          before(async () => {
            await initBaseCase(customFolioTokenMint, new BN(1000_000_000_000));

            currentClock = await context.banksClient.getClock();

            // Get the ATAs for the fee recipients we want to send to the instruction
            for (const feeRecipient of feeRecipientsToDistributeTo) {
              const feeRecipientATA = await getOrCreateAtaAddress(
                context,
                folioTokenMint.publicKey,
                feeRecipient.recipient
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
              initialFeeRecipientPendingFeeShares
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

                true
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
                assert.equal(
                  await banksClient.getAccount(
                    getFeeDistributionPDA(folioPDA, feeDistributionIndex)
                  ),
                  null
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
            });
          }
        });
      }
    );
  });
});
