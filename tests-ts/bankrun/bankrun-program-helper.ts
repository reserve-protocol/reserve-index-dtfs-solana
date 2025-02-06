import { LAMPORTS_PER_SOL, PublicKey, Transaction } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import {
  BanksTransactionResultWithMeta,
  ProgramTestContext,
  startAnchor,
} from "solana-bankrun";
import fs from "fs/promises";
import path from "path";

import { TransactionInstruction } from "@solana/web3.js";

import { Keypair } from "@solana/web3.js";
import { BanksClient } from "solana-bankrun";
import { SYSTEM_PROGRAM_ID } from "@coral-xyz/anchor/dist/cjs/native/system";
import { Folio } from "../../target/types/folio";
import idlFolio from "../../target/idl/folio.json";
import idlSecondFolio from "../../target/idl/second_folio.json";
import idlFolioAdmin from "../../target/idl/folio_admin.json";
import { BankrunProvider } from "anchor-bankrun";
import * as assert from "assert";
import { AnchorError } from "@coral-xyz/anchor";
import { TOKEN_METADATA_PROGRAM_ID } from "../../utils/constants";
import { FolioAdmin } from "../../target/types/folio_admin";
import { Folio as FolioSecond } from "../../target/types/second_folio";
export async function getConnectors() {
  const keysFileName = "keys-local.json";

  const keys = JSON.parse(
    (
      await fs.readFile(path.join(__dirname, "../../utils/keys", keysFileName))
    ).toString()
  );

  // Copy metadata program to target
  await fs.copyFile(
    path.join(__dirname, "../programs/metadata.so"),
    path.join(__dirname, "../../target/deploy/metadata.so")
  );

  const context = await startAnchor(
    path.join(__dirname, "../.."),
    [
      { name: "folio_admin", programId: new PublicKey(idlFolioAdmin.address) },
      { name: "folio", programId: new PublicKey(idlFolio.address) },
      {
        name: "second_folio",
        programId: new PublicKey(idlSecondFolio.address),
      },
      { name: "metadata", programId: TOKEN_METADATA_PROGRAM_ID },
    ],
    []
  );

  const provider = new BankrunProvider(context);
  anchor.setProvider(provider);

  return {
    context,
    keys,
    programFolioAdmin: new anchor.Program<FolioAdmin>(
      idlFolioAdmin as FolioAdmin
    ),
    programFolio: new anchor.Program<Folio>(idlFolio as Folio),
    programFolioSecond: new anchor.Program<FolioSecond>(
      idlSecondFolio as FolioSecond
    ),
    provider,
  };
}

export async function createAndProcessTransaction(
  client: BanksClient,
  payer: Keypair,
  instruction: TransactionInstruction[],
  extraSigners: Keypair[] = []
): Promise<BanksTransactionResultWithMeta> {
  const tx = new Transaction();

  const [latestBlockhash] = await client.getLatestBlockhash();

  tx.recentBlockhash = latestBlockhash;

  tx.add(...instruction);

  tx.feePayer = payer.publicKey;

  tx.sign(payer, ...extraSigners);

  return await client.tryProcessTransaction(tx);
}

export async function airdrop(
  context: ProgramTestContext,
  account: PublicKey,
  amount: number
) {
  const airdropAccountInfo = {
    lamports: amount * LAMPORTS_PER_SOL,
    data: Buffer.alloc(0),
    owner: SYSTEM_PROGRAM_ID,
    executable: false,
  };

  context.setAccount(account, airdropAccountInfo);
}

export async function travelFutureSlot(context: ProgramTestContext) {
  context.warpToSlot((await context.banksClient.getSlot()) + BigInt(1));
}

export function assertError(
  txnResult: BanksTransactionResultWithMeta,
  expectedError: string
) {
  const anchorParsedError = AnchorError.parse(txnResult.meta.logMessages);

  if (anchorParsedError) {
    assert.equal(
      AnchorError.parse(txnResult.meta.logMessages).error.errorCode.code,
      expectedError
    );
    return;
  }

  const regex = /Program log: Error: (.+)/;

  const errorLogLine = txnResult.meta.logMessages.find((log) =>
    log.match(regex)
  );

  const matchedLog = errorLogLine?.match(regex);
  if (matchedLog && matchedLog[1]) {
    const errorMessage = matchedLog[1];

    const formattedMessage = errorMessage
      .split(" ")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join("");

    assert.equal(formattedMessage, expectedError);
    return;
  }

  assert.fail("Error not found");
}

export function assertPreTransactionError(error: any, expectedError: string) {
  const regex = /Error: (.+):/;
  const matchedLog = error.toString().match(regex);

  if (matchedLog && matchedLog[1]) {
    const errorMessage = matchedLog[1];

    const formattedMessage = errorMessage
      .split(" ")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join("");

    assert.equal(formattedMessage, expectedError);
    return;
  }

  assert.fail("Error not found");
}

export function buildExpectedArray(
  preAdded: any[],
  added: any[],
  removed: any[],
  max: number,
  defaultValue: any,
  filterFunction: (current: any) => boolean
) {
  return preAdded
    .concat(added)
    .filter(filterFunction)
    .concat(
      Array(max - preAdded.length - added.length + removed.length).fill(
        defaultValue
      )
    );
}
