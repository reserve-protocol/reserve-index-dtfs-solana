import {
  createMint,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import { DEFAULT_DECIMALS } from "./constants";

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

export async function mintToken(
  connection: Connection,
  mintAuthority: Keypair,
  mint: PublicKey,
  amount: number,
  recipient: PublicKey,
  decimals: number = DEFAULT_DECIMALS
) {
  const ata = (
    await getOrCreateAssociatedTokenAccount(
      connection,
      mintAuthority,
      mint,
      recipient,
      true
    )
  ).address;

  await mintTo(
    connection,
    mintAuthority,
    mint,
    ata,
    mintAuthority,
    amount * 10 ** decimals
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
  owner: PublicKey
) {
  return (
    await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      mint,
      owner,
      true
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
