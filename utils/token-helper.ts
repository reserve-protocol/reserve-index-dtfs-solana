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

export const DEFAULT_DECIMALS = 9;

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
  receiver: PublicKey,
  decimals: number = DEFAULT_DECIMALS
) {
  let ata = (
    await getOrCreateAssociatedTokenAccount(
      connection,
      mintAuthority,
      mint,
      receiver,
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
  receiver: PublicKey,
  decimals: number = DEFAULT_DECIMALS
): Promise<{
  instruction: TransactionInstruction;
  senderAta: PublicKey;
  receiverAta: PublicKey;
}> {
  let receiverAta = await getOrCreateAtaAddress(
    connection,
    mint,
    payer,
    receiver
  );

  let senderAta = await getOrCreateAtaAddress(connection, mint, payer, sender);

  return {
    instruction: createTransferCheckedInstruction(
      senderAta,
      mint,
      receiverAta,
      sender,
      amount * 10 ** decimals,
      decimals
    ),
    senderAta,
    receiverAta,
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

export function getAtaAddress(
  connection: Connection,
  mint: PublicKey,
  owner: PublicKey
) {
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

export function getAtaAddress2022(
  connection: Connection,
  mint: PublicKey,
  owner: PublicKey
) {
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
