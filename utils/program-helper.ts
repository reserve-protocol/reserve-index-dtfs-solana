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
import { Dtfs } from "../target/types/dtfs";
import idlDtfs from "../target/idl/dtfs.json";
import { Folio } from "../target/types/folio";
import idlFolio from "../target/idl/folio.json";
import * as assert from "assert";

export async function getConnectors() {
  let rpcUrl = "";
  let keysFileName = "";
  // let dtfsProgramId = "";
  // let folioProgramId = "";

  switch (process.env.NODE_ENV) {
    case "devnet":
      // dtfsProgramId = "Cr1UEkStzJPQ4wa9Lr6ryJWci83baMvrQLT3skd1eLmG";
      // folioProgramId = "n6sR7Eg5LMg5SGorxK9q3ZePHs9e8gjoQ7TgUW2YCaG";
      rpcUrl = "https://api.devnet.solana.com";
      keysFileName = "keys-devnet.json";
      break;
    default:
      // dtfsProgramId = idlDtfs.address;
      // folioProgramId = idlFolio.address;
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
    programDtf: new anchor.Program<Dtfs>(idlDtfs as Dtfs),
    programFolio: new anchor.Program<Folio>(idlFolio as Folio),
    anchorProvider,
  };
}

export async function wait(seconds = 2) {
  await new Promise((f) => setTimeout(f, seconds * 1_000));
}

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
  receiver: PublicKey,
  amount: number
) {
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");

  await connection.confirmTransaction(
    {
      blockhash: blockhash,
      lastValidBlockHeight: lastValidBlockHeight,
      signature: await connection.requestAirdrop(
        receiver,
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
