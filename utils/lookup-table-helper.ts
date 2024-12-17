import {
  AddressLookupTableProgram,
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

/*
Taken from solana website
 */
async function createAndSendV0Tx(
  txInstructions: TransactionInstruction[],
  connection: Connection,
  signer: any
) {
  let latestBlockhash = await connection.getLatestBlockhash("finalized");

  const messageV0 = new TransactionMessage({
    payerKey: signer.publicKey,
    recentBlockhash: latestBlockhash.blockhash,
    instructions: txInstructions,
  }).compileToV0Message();

  const transaction = new VersionedTransaction(messageV0);

  transaction.sign([signer]);

  const txid = await connection.sendTransaction(transaction, {
    maxRetries: 5,
  });

  const confirmation = await connection.confirmTransaction({
    signature: txid,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  });
}

export async function initLUT(
  connection: Connection,
  adminKeypair: Keypair
): Promise<PublicKey> {
  const slot = await connection.getSlot();

  const [lookupTableInst, lookupTableAddress] =
    AddressLookupTableProgram.createLookupTable({
      authority: adminKeypair.publicKey,
      payer: adminKeypair.publicKey,
      recentSlot: slot - 1,
    });

  await createAndSendV0Tx([lookupTableInst], connection, adminKeypair);

  return lookupTableAddress;
}

export async function extendLUT(
  connection: Connection,
  adminKeypair: Keypair,
  lookupTable: PublicKey,
  addresses: PublicKey[]
) {
  const extendInstruction = AddressLookupTableProgram.extendLookupTable({
    payer: adminKeypair.publicKey,
    authority: adminKeypair.publicKey,
    lookupTable: lookupTable,
    addresses,
  });

  await createAndSendV0Tx([extendInstruction], connection, adminKeypair);
}
