import {
  createMint,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  getMetadataPointerState,
  getMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import { DEFAULT_DECIMALS } from "./constants";

/**
 * Helper functions for token operations including initialization, minting,
 * transfers, and balance checking. Provides utilities for managing SPL tokens
 * and associated token accounts for both SPL and SPL-Token-2022.
 */

export async function initToken(
  connection: Connection,
  mintAuthority: Keypair,
  mint: Keypair = Keypair.generate(),
  decimals: number = DEFAULT_DECIMALS
) {
  await createMint(
    connection,
    mintAuthority,
    mintAuthority.publicKey,
    null,
    decimals,
    mint
  );
}

export async function initToken2022(
  connection: Connection,
  mintAuthority: Keypair,
  mint: Keypair = Keypair.generate(),
  decimals: number = DEFAULT_DECIMALS
) {
  await createMint(
    connection,
    mintAuthority,
    mintAuthority.publicKey,
    null,
    decimals,
    mint,
    undefined,
    TOKEN_2022_PROGRAM_ID
  );
}

export async function mintToken(
  connection: Connection,
  mintAuthority: Keypair,
  mint: PublicKey,
  amount: number,
  recipient: PublicKey,
  decimals: number = DEFAULT_DECIMALS,
  program: PublicKey = TOKEN_PROGRAM_ID
) {
  const ata = (
    await getOrCreateAssociatedTokenAccount(
      connection,
      mintAuthority,
      mint,
      recipient,
      true,
      undefined,
      undefined,
      program
    )
  ).address;

  await mintTo(
    connection,
    mintAuthority,
    mint,
    ata,
    mintAuthority,
    amount * 10 ** decimals,
    undefined,
    undefined,
    program
  );
}

export async function transferToken(
  connection: Connection,
  payer: Keypair,
  sender: PublicKey,
  mint: PublicKey,
  amount: number,
  recipient: PublicKey,
  decimals: number = DEFAULT_DECIMALS
): Promise<{
  instruction: TransactionInstruction;
  senderAta: PublicKey;
  recipientAta: PublicKey;
}> {
  const recipientAta = await getOrCreateAtaAddress(
    connection,
    mint,
    payer,
    recipient
  );

  const senderAta = await getOrCreateAtaAddress(
    connection,
    mint,
    payer,
    sender
  );

  return {
    instruction: createTransferCheckedInstruction(
      senderAta,
      mint,
      recipientAta,
      sender,
      amount * 10 ** decimals,
      decimals
    ),
    senderAta,
    recipientAta,
  };
}

export async function getOrCreateAtaAddress(
  connection: Connection,
  mint: PublicKey,
  payer: Keypair,
  owner: PublicKey,
  program: PublicKey = TOKEN_PROGRAM_ID
) {
  return (
    await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      mint,
      owner,
      true,
      undefined,
      undefined,
      program
    )
  ).address;
}

export async function getAtaAddress(mint: PublicKey, owner: PublicKey) {
  return getAssociatedTokenAddressSync(mint, owner, true);
}

export async function getOrCreateAtaAddress2022(
  connection: Connection,
  mint: PublicKey,
  payer: Keypair,
  owner: PublicKey
) {
  return (
    await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      mint,
      owner,
      true,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    )
  ).address;
}

export async function getAtaAddress2022(mint: PublicKey, owner: PublicKey) {
  return getAssociatedTokenAddressSync(
    mint,
    owner,
    true,
    TOKEN_2022_PROGRAM_ID
  );
}

export async function getTokenBalance(
  connection: Connection,
  account: PublicKey,
  isNative: boolean = false
): Promise<number> {
  if (isNative) {
    return await connection.getBalance(account);
  }
  return (await connection.getTokenAccountBalance(account)).value.uiAmount;
}

export async function getTokenMetadata(
  connection: Connection,
  mint: PublicKey
): Promise<{
  metadataPointer: any;
  metadata: any;
  name: string;
  symbol: string;
  uri: string;
}> {
  const mintInfo = await getMint(
    connection,
    mint,
    "confirmed",
    TOKEN_2022_PROGRAM_ID
  );

  const metadataPointer = getMetadataPointerState(mintInfo);

  const metadata = await getTokenMetadata(connection, mint);

  return {
    metadataPointer,
    metadata,
    name: metadata.name,
    symbol: metadata.symbol,
    uri: metadata.uri,
  };
}
