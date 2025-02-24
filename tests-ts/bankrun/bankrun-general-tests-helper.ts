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
import { createAndSetFolio, FolioStatus, Role } from "./bankrun-account-helper";
import { createAndSetActor } from "./bankrun-account-helper";
import { Program } from "@coral-xyz/anchor";
import { Folio } from "../../target/types/folio";
import { OTHER_ADMIN_KEY } from "../../utils/constants";

export enum GeneralTestCases {
  NotAdmin = "not admin",
  NotRole = "not role",
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

export async function assertNotValidRoleTestCase(
  context: ProgramTestContext,
  programFolio: Program<Folio>,
  actorKeypair: Keypair | PublicKey,
  folioPDA: PublicKey,
  executeTxn: () => Promise<BanksTransactionResultWithMeta>,
  // By default (the test case the most often is not owner, so we set something not owner)
  role: Role = Role.AuctionLauncher
) {
  await createAndSetActor(context, programFolio, actorKeypair, folioPDA, role);

  await travelFutureSlot(context);

  const txnResult = await executeTxn();

  assertError(txnResult, "InvalidRole");
}

export async function assertInvalidFolioStatusTestCase(
  context: ProgramTestContext,
  programFolio: Program<Folio>,
  folioTokenMint: PublicKey,
  executeTxn: () => Promise<BanksTransactionResultWithMeta>,
  newFolioStatus: FolioStatus = FolioStatus.Killed
) {
  await createAndSetFolio(
    context,
    programFolio,
    folioTokenMint,
    newFolioStatus
  );

  await travelFutureSlot(context);

  const txnResult = await executeTxn();

  assertError(txnResult, "InvalidFolioStatus");
}
