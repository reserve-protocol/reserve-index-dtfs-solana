import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import { Folio } from "../../../target/types/folio";
import { BankrunProvider } from "anchor-bankrun";
import {
  BanksClient,
  BanksTransactionResultWithMeta,
  ProgramTestContext,
} from "solana-bankrun";

import { getActorPDA, getFolioPDA } from "../../../utils/pda-helper";

import {
  airdrop,
  assertError,
  getConnectors,
  travelFutureSlot,
} from "../bankrun-program-helper";
import {
  createAndSetActor,
  createAndSetFolio,
  Role,
} from "../bankrun-account-helper";
import {
  assertNotValidRoleTestCase,
  GeneralTestCases,
} from "../bankrun-general-tests-helper";
import { addOrUpdateActor, removeActor } from "../bankrun-ix-helper";
import * as assert from "assert";

/**
 * Tests for actor-related functionality in the Folio program, including:
 * - Adding/updating actors with different roles
 * - Removing actors and their roles
 * - Role validation and permissions
 * - Account closure when all roles are removed
 */

describe("Bankrun - Actor", () => {
  let context: ProgramTestContext;
  let provider: BankrunProvider;
  let banksClient: BanksClient;

  let programFolio: Program<Folio>;

  let keys: any;

  let payerKeypair: Keypair;
  let adminKeypair: Keypair;

  let folioOwnerKeypair: Keypair;
  let newActorKeypair: Keypair;
  let folioTokenMint: Keypair;

  let folioPDA: PublicKey;

  const TEST_CASES_ADD_OR_UPDATE_ACTOR = [
    {
      desc: "(gives non existing role, failure)",
      currentRole: null,
      newRole: 0b10000000,
      expectedError: "InstructionDidNotDeserialize",
    },
    {
      desc: "(already have role to give, doesn't change anything, success)",
      currentRole: Role.RebalanceManager,
      newRole: Role.RebalanceManager,
      expectedError: null,
    },
    {
      desc: "(doesn't have role, give, success)",
      currentRole: Role.AuctionLauncher,
      newRole: Role.RebalanceManager,
      expectedError: null,
    },

    {
      desc: "(already have one role, gives 1 new roles, success)",
      currentRole: Role.Owner,
      newRole: Role.RebalanceManager,
      expectedError: null,
    },
  ];

  const TEST_CASES_REMOVE_ACTOR = [
    {
      desc: "(already have role, remove random role, success)",
      currentRole: Role.Owner,
      roleToRemove: Role.RebalanceManager,
      accountIsClosed: false,
      expectedError: null,
    },
    {
      desc: "(already have role, remove role actor has, success)",
      currentRole: Role.Owner,
      roleToRemove: Role.Owner,
      accountIsClosed: false,
      expectedError: null,
    },
    {
      desc: "(close actor, success)",
      currentRole: Role.Owner,
      roleToRemove: Role.Owner,
      accountIsClosed: true,
      expectedError: null,
    },
  ];

  async function initBaseCase() {
    await createAndSetFolio(context, programFolio, folioTokenMint.publicKey);

    await createAndSetActor(
      context,
      programFolio,
      folioOwnerKeypair,
      folioPDA,
      Role.Owner
    );
  }

  before(async () => {
    ({ keys, programFolio, provider, context } = await getConnectors());

    banksClient = context.banksClient;

    payerKeypair = provider.wallet.payer;

    adminKeypair = Keypair.fromSecretKey(Uint8Array.from(keys.admin));

    folioOwnerKeypair = Keypair.generate();
    folioTokenMint = Keypair.generate();
    newActorKeypair = Keypair.generate();

    await airdrop(context, payerKeypair.publicKey, 1000);
    await airdrop(context, adminKeypair.publicKey, 1000);
    await airdrop(context, folioOwnerKeypair.publicKey, 1000);
    await airdrop(context, newActorKeypair.publicKey, 1000);

    folioPDA = getFolioPDA(folioTokenMint.publicKey);
  });

  beforeEach(async () => {
    await initBaseCase();
  });

  describe("General Tests", () => {
    const generalIxInitOrUpdateActor = () =>
      addOrUpdateActor<true>(
        banksClient,
        programFolio,
        folioOwnerKeypair,
        folioPDA,
        newActorKeypair.publicKey,
        Role.Owner
      );

    const generalIxRemoveActor = () =>
      removeActor<true>(
        banksClient,
        programFolio,
        folioOwnerKeypair,
        folioPDA,
        newActorKeypair.publicKey,
        Role.Owner,
        false
      );

    describe("should run general tests for init or update actor", () => {
      it(`should run ${GeneralTestCases.NotRole}`, async () => {
        await assertNotValidRoleTestCase(
          context,
          programFolio,
          folioOwnerKeypair,
          folioPDA,
          generalIxInitOrUpdateActor
        );
      });
    });

    describe("should run general tests for remove actor", () => {
      beforeEach(async () => {
        await createAndSetActor(
          context,
          programFolio,
          newActorKeypair,
          folioPDA,
          Role.RebalanceManager
        );
      });

      it(`should run ${GeneralTestCases.NotRole}`, async () => {
        await assertNotValidRoleTestCase(
          context,
          programFolio,
          folioOwnerKeypair,
          folioPDA,
          generalIxRemoveActor
        );
      });
    });
  });

  describe("Specific Cases - Init or Update Actor", () => {
    TEST_CASES_ADD_OR_UPDATE_ACTOR.forEach(
      ({ desc, expectedError, ...restOfParams }) => {
        describe(`When ${desc}`, () => {
          let txnResult: BanksTransactionResultWithMeta;
          const { currentRole, newRole } = { ...restOfParams };

          before(async () => {
            await initBaseCase();

            if (currentRole) {
              await createAndSetActor(
                context,
                programFolio,
                newActorKeypair,
                folioPDA,
                currentRole
              );
            }

            await travelFutureSlot(context);

            txnResult = await addOrUpdateActor<true>(
              banksClient,
              programFolio,
              folioOwnerKeypair,
              folioPDA,
              newActorKeypair.publicKey,
              newRole
            );
          });

          if (expectedError) {
            it("should fail with expected error", () => {
              assertError(txnResult, expectedError);
            });
          } else {
            it("should succeed", async () => {
              await travelFutureSlot(context);

              const newActor = await programFolio.account.actor.fetch(
                getActorPDA(newActorKeypair.publicKey, folioPDA)
              );

              assert.equal(newActor.roles, newRole | currentRole);
              assert.equal(
                newActor.authority.toString(),
                newActorKeypair.publicKey.toString()
              );
              assert.equal(newActor.folio.toString(), folioPDA.toString());
            });
          }
        });
      }
    );
  });

  describe("Specific Cases - Remove Actor", () => {
    TEST_CASES_REMOVE_ACTOR.forEach(
      ({ desc, expectedError, ...restOfParams }) => {
        describe(`When ${desc}`, () => {
          let txnResult: BanksTransactionResultWithMeta;
          const { currentRole, roleToRemove, accountIsClosed } = {
            ...restOfParams,
          };

          before(async () => {
            await initBaseCase();

            if (currentRole) {
              await createAndSetActor(
                context,
                programFolio,
                newActorKeypair,
                folioPDA,
                currentRole
              );
            }

            await travelFutureSlot(context);

            txnResult = await removeActor<true>(
              banksClient,
              programFolio,
              folioOwnerKeypair,
              folioPDA,
              newActorKeypair.publicKey,
              roleToRemove,
              accountIsClosed
            );
          });

          if (expectedError) {
            it("should fail with expected error", () => {
              assertError(txnResult, expectedError);
            });
          } else {
            it("should succeed", async () => {
              await travelFutureSlot(context);

              if (accountIsClosed) {
                const actorAccount = await context.banksClient.getAccount(
                  getActorPDA(newActorKeypair.publicKey, folioPDA)
                );
                assert.equal(actorAccount, null);
                return;
              }

              const newActor = await programFolio.account.actor.fetch(
                getActorPDA(newActorKeypair.publicKey, folioPDA)
              );

              assert.equal(newActor.roles, currentRole & ~roleToRemove);
              assert.equal(
                newActor.authority.toString(),
                newActorKeypair.publicKey.toString()
              );
              assert.equal(newActor.folio.toString(), folioPDA.toString());
            });
          }
        });
      }
    );
  });
});
