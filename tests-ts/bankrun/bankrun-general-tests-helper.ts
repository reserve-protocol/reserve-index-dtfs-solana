import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";

import {
  BanksTransactionResultWithMeta,
  ProgramTestContext,
} from "solana-bankrun";
import {
  assertError,
  createAndProcessTransaction,
} from "./bankrun-program-helper";
import {
  createAndSetFolio,
  createAndSetProgramRegistrar,
  FolioStatus,
  mockDTFProgramData,
  Role,
} from "./bankrun-account-helper";
import { createAndSetActor } from "./bankrun-account-helper";
import { BN, Program } from "@coral-xyz/anchor";
import { Folio } from "../../target/types/folio";
import { DTF_PROGRAM_ID } from "../../utils/constants";

export enum GeneralTestCases {
  NotAdmin = "not admin",
  NotOwner = "not owner",
  InvalidDtfProgramDeploymentSlot = "invalid dtf program deployment slot",
  ProgramNotInRegistrar = "program not in registrar",
  InvalidFolioStatus = "invalid folio status",
}

export async function assertNonAdminTestCase(
  context: ProgramTestContext,
  executeTxn: () => Promise<{
    ix: TransactionInstruction;
    extraSigners: Keypair[];
  }>,
  otherKeypair: Keypair
) {
  const { ix, extraSigners } = await executeTxn();

  const txnResult = await createAndProcessTransaction(
    context.banksClient,
    otherKeypair,
    [ix],
    extraSigners
  );

  assertError(txnResult, "Unauthorized");
}

export async function assertNotOwnerTestCase(
  context: ProgramTestContext,
  programFolio: Program<Folio>,
  folioOwnerKeypair: Keypair,
  folioPDA: PublicKey,
  executeTxn: () => Promise<BanksTransactionResultWithMeta>
) {
  await createAndSetActor(
    context,
    programFolio,
    folioOwnerKeypair,
    folioPDA,
    Role.TradeLauncher
  );

  const txnResult = await executeTxn();

  assertError(txnResult, "InvalidRole");
}

/*
This is too complex to test, we would need to rebuild a program dynamically with changing the declare id in anchor, and then add it to banrkun.
*/
// export async function assertInvalidDtfProgramTestCase(
//   context: ProgramTestContext,
//   executeTxn: () => Promise<BanksTransactionResultWithMeta>
// ) {
//   let txnResult: BanksTransactionResultWithMeta;

//   await mockDTFProgramData(context, DTF_PROGRAM_ID, new BN(1));

//   txnResult = await executeTxn();

//   assertError(txnResult, "InvalidProgramVersion");
// }

export async function assertInvalidDtfProgramDeploymentSlotTestCase(
  context: ProgramTestContext,
  invalidSlot: BN,
  executeTxn: () => Promise<BanksTransactionResultWithMeta>
) {
  await mockDTFProgramData(context, DTF_PROGRAM_ID, invalidSlot);

  const txnResult = await executeTxn();

  assertError(txnResult, "InvalidProgram");
}

export async function assertProgramNotInRegistrarTestCase(
  context: ProgramTestContext,
  programFolio: Program<Folio>,
  executeTxn: () => Promise<BanksTransactionResultWithMeta>
) {
  await createAndSetProgramRegistrar(context, programFolio, []);

  const txnResult = await executeTxn();

  assertError(txnResult, "ProgramNotInRegistrar");
}

export async function assertInvalidFolioStatusTestCase(
  context: ProgramTestContext,
  programFolio: Program<Folio>,
  folioTokenMint: PublicKey,
  folioPDA: PublicKey,
  validDeploymentSlot: BN,
  executeTxn: () => Promise<BanksTransactionResultWithMeta>
) {
  await createAndSetFolio(
    context,
    programFolio,
    folioTokenMint,
    folioPDA,
    validDeploymentSlot,
    FolioStatus.Killed
  );

  const txnResult = await executeTxn();

  assertError(txnResult, "InvalidFolioStatus");
}

export async function runMultipleGeneralTests(
  testCases: GeneralTestCases[],
  context: ProgramTestContext,
  programFolio: Program<Folio> = null,
  folioOwnerKeypair: Keypair = null,
  folioPDA: PublicKey = null,
  validDeploymentSlot: BN = null,
  folioTokenMint: PublicKey = null,
  executeTxn: () => Promise<BanksTransactionResultWithMeta> = null,
  createInstruction: () => Promise<{
    ix: TransactionInstruction;
    extraSigners: Keypair[];
  }> = null
) {
  testCases.forEach((testCase) => {
    it(testCase, async () => {
      switch (testCase) {
        case GeneralTestCases.NotOwner:
          await assertNotOwnerTestCase(
            context,
            programFolio,
            folioOwnerKeypair,
            folioPDA,
            executeTxn
          );
          break;
        case GeneralTestCases.InvalidDtfProgramDeploymentSlot:
          await assertInvalidDtfProgramDeploymentSlotTestCase(
            context,
            validDeploymentSlot.add(new BN(1)),
            executeTxn
          );
          break;
        case GeneralTestCases.ProgramNotInRegistrar:
          await assertProgramNotInRegistrarTestCase(
            context,
            programFolio,
            executeTxn
          );
          break;
        case GeneralTestCases.InvalidFolioStatus:
          await assertInvalidFolioStatusTestCase(
            context,
            programFolio,
            folioTokenMint,
            folioPDA,
            validDeploymentSlot,
            executeTxn
          );
          break;
        case GeneralTestCases.NotAdmin:
          await assertNonAdminTestCase(
            context,

            createInstruction,
            folioOwnerKeypair
          );
          break;
      }
    });
  });
}
