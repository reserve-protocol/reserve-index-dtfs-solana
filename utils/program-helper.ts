import * as anchor from "@coral-xyz/anchor";
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";
import {
  Commitment,
  ComputeBudgetProgram,
  ConfirmOptions,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SendOptions,
  Signer,
  Transaction,
  TransactionInstruction,
  TransactionSignature,
} from "@solana/web3.js";
import fs from "fs/promises";
import path from "path";
import { Folio } from "../target/types/folio";
import idlFolio from "../target/idl/folio.json";
import { Folio as SecondFolio } from "../target/types/second_folio";
import idlSecondFolio from "../target/idl/second_folio.json";
import * as assert from "assert";
import { FolioAdmin } from "../target/types/folio_admin";
import idlFolioAdmin from "../target/idl/folio_admin.json";

/**
 * Utility functions for program interaction and transaction management.
 * Includes helpers for connection setup, transaction sending/confirmation,
 * and common Solana operations like airdrops and compute budget management.
 */

export async function getConnectors() {
  let rpcUrl = "";
  let keysFileName = "";

  switch (process.env.NODE_ENV) {
    case "devnet":
      rpcUrl = "https://api.devnet.solana.com";
      keysFileName = "keys-devnet.json";
      break;
    default:
      rpcUrl = "http://127.0.0.1:8899";
      keysFileName = "keys-local.json";
  }

  const connection = new Connection(rpcUrl, {
    commitment: "confirmed",
  });

  const keys = JSON.parse(
    (await fs.readFile(path.join(__dirname, "keys", keysFileName))).toString()
  );

  const payerKeypair = Keypair.fromSecretKey(Uint8Array.from(keys.payer));

  const anchorProvider = new anchor.AnchorProvider(
    connection,
    new NodeWallet(payerKeypair),
    anchor.AnchorProvider.defaultOptions()
  );

  anchor.setProvider(anchorProvider);

  return {
    connection,
    keys,
    programFolioAdmin: new anchor.Program<FolioAdmin>(
      idlFolioAdmin as FolioAdmin
    ),
    programFolio: new anchor.Program<Folio>(idlFolio as Folio),
    programSecondFolio: new anchor.Program<SecondFolio>(
      idlSecondFolio as SecondFolio
    ),
    anchorProvider,
  };
}

export async function wait(seconds = 2) {
  await new Promise((f) => setTimeout(f, seconds * 1_000));
}

/**
 * Send and confirm a transaction with optional fee payment and additional signers.
 * Handles transaction creation, signing, and confirmation via the connection directly.
 */
export async function cSendAndConfirmTxn(
  connection: Connection,
  txn: TransactionInstruction[],
  feePayer: Signer,
  additionalSigners: Signer[] = [],
  opts: SendOptions = { skipPreflight: false },
  commitment: Commitment = "confirmed"
): Promise<{ signature: TransactionSignature; error: Error | null }> {
  try {
    const transaction = new Transaction();

    transaction.add(...txn);
    transaction.feePayer = feePayer.publicKey;

    transaction.recentBlockhash = (
      await connection.getLatestBlockhash()
    ).blockhash;

    if (additionalSigners.length > 0) {
      transaction.sign(feePayer, ...additionalSigners);
    } else {
      transaction.sign(feePayer);
    }

    const signature = await connection.sendRawTransaction(
      transaction.serialize(),
      opts
    );

    const confirmation = await connection.confirmTransaction(
      {
        signature,
        blockhash: transaction.recentBlockhash,
        lastValidBlockHeight: (
          await connection.getLatestBlockhash()
        ).lastValidBlockHeight,
      },
      commitment
    );

    if (confirmation.value.err) {
      throw new Error(
        `Transaction failed: ${confirmation.value.err.toString()}`
      );
    }

    return { signature, error: null };
  } catch (err) {
    throw err;
  }
}

/**
 * Send and confirm a transaction with optional fee payment and additional signers.
 * Handles transaction creation, signing, and confirmation via the program provider.
 */
export async function pSendAndConfirmTxn(
  program: anchor.Program<any>,
  txn: TransactionInstruction[],
  additionalSigners: Signer[] = [],
  opts: ConfirmOptions = { skipPreflight: false, commitment: "confirmed" },
  expectError: boolean = false
): Promise<{ signature: TransactionSignature; error: Error | null }> {
  try {
    const transaction = new Transaction();
    transaction.add(...txn);

    const signature = await program.provider.sendAndConfirm(
      transaction,
      additionalSigners,
      // Can't skip preflight when expecting an error, anchor issues
      { ...opts, ...(expectError ? { skipPreflight: false } : {}) }
    );

    return { signature, error: null };
  } catch (err) {
    throw err;
  }
}

export async function airdrop(
  connection: Connection,
  recipient: PublicKey,
  amount: number
) {
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");

  await connection.confirmTransaction(
    {
      blockhash: blockhash,
      lastValidBlockHeight: lastValidBlockHeight,
      signature: await connection.requestAirdrop(
        recipient,
        amount * LAMPORTS_PER_SOL
      ),
    },
    "confirmed"
  );

  await wait();
}

export function getComputeLimitInstruction(
  newLimit: number = 400_000
): TransactionInstruction[] {
  return [
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: 1000,
    }),
    ComputeBudgetProgram.setComputeUnitLimit({
      units: newLimit,
    }),
  ];
}

/**
 * Assert that a function throws an error with a specific error code.
 * Checks the error logs for the expected error code and fails if not found.
 */
export async function assertThrows(
  fn: () => Promise<any>,
  expectedErrorCode: string | number,
  message?: string
) {
  try {
    await fn();
    assert.fail(message || "Expected an error to be thrown");
  } catch (error) {
    for (const log of error.logs) {
      if (log.includes(expectedErrorCode)) {
        return;
      }
    }

    assert.fail(message || `Expected error code ${expectedErrorCode}`);
  }
}

export async function getSolanaCurrentTime(
  connection: Connection
): Promise<number> {
  const currentSlot = await connection.getSlot();
  return connection.getBlockTime(currentSlot);
}
