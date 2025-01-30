import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";

import {
  BanksTransactionResultWithMeta,
  ProgramTestContext,
} from "solana-bankrun";
import {
  airdrop,
  assertError,
  createAndProcessTransaction,
  travelFutureSlot,
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
import { DTF_PROGRAM_ID, OTHER_ADMIN_KEY } from "../../utils/constants";

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
  }>
) {
  await airdrop(context, OTHER_ADMIN_KEY.publicKey, 1000);

  const { ix, extraSigners } = await executeTxn();

  const txnResult = await createAndProcessTransaction(
    context.banksClient,
    OTHER_ADMIN_KEY,
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

  await travelFutureSlot(context);

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

  await travelFutureSlot(context);

  const txnResult = await executeTxn();

  assertError(txnResult, "InvalidProgram");
}

export async function assertProgramNotInRegistrarTestCase(
  context: ProgramTestContext,
  programFolio: Program<Folio>,
  executeTxn: () => Promise<BanksTransactionResultWithMeta>
) {
  await createAndSetProgramRegistrar(context, programFolio, []);

  await travelFutureSlot(context);

  const txnResult = await executeTxn();

  assertError(txnResult, "ProgramNotInRegistrar");
}

export async function assertInvalidFolioStatusTestCase(
  context: ProgramTestContext,
  programFolio: Program<Folio>,
  folioTokenMint: PublicKey,
  programVersion: PublicKey,
  validDeploymentSlot: BN,
  executeTxn: () => Promise<BanksTransactionResultWithMeta>
) {
  await createAndSetFolio(
    context,
    programFolio,
    folioTokenMint,
    programVersion,
    validDeploymentSlot,
    FolioStatus.Killed
  );

  await travelFutureSlot(context);

  const txnResult = await executeTxn();

  assertError(txnResult, "InvalidFolioStatus");
}
