import { Keypair, PublicKey } from "@solana/web3.js";
import { DEFAULT_DECIMALS } from "../../utils/constants";
import { BanksClient, ProgramTestContext } from "solana-bankrun";
import {
  getAssociatedTokenAddressSync,
  MintLayout,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  ACCOUNT_SIZE,
  AccountLayout,
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  getMintLen,
  createInitializeMint2Instruction,
  createInitializeTransferHookInstruction,
  createInitializePermanentDelegateInstruction,
  createMintToInstruction,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import * as assert from "assert";
import { BN } from "@coral-xyz/anchor";
import { SystemProgram } from "@solana/web3.js";
import { createAndProcessTransaction } from "./bankrun-program-helper";

/**
 * Helper functions for token operations in the Bankrun environment.
 * Handles minting, token creation, and balance management.
 */

export function initToken(
  context: ProgramTestContext,
  mintAuthority: PublicKey,
  mint: Keypair | PublicKey = Keypair.generate(),
  decimals: number = DEFAULT_DECIMALS,
  supply: BN = new BN(0),
  programId: PublicKey = TOKEN_PROGRAM_ID
) {
  const mintAccData = Buffer.alloc(MINT_SIZE);
  MintLayout.encode(
    {
      mintAuthorityOption: 1,
      mintAuthority: mintAuthority,
      supply: BigInt(supply.toString()),
      decimals,
      isInitialized: true,
      freezeAuthorityOption: 1,
      freezeAuthority: mintAuthority,
    },
    mintAccData
  );

  context.setAccount(mint instanceof Keypair ? mint.publicKey : mint, {
    lamports: 1_000_000_000,
    data: mintAccData,
    owner: programId,
    executable: false,
  });
}

export function mintToken(
  context: ProgramTestContext,
  mint: PublicKey,
  amount: number,
  recipient: PublicKey,
  decimals: number = DEFAULT_DECIMALS,
  tokenProgram: PublicKey = TOKEN_PROGRAM_ID
) {
  const tokenAccData = Buffer.alloc(ACCOUNT_SIZE);
  AccountLayout.encode(
    {
      mint: mint,
      owner: recipient,
      amount: BigInt(amount * 10 ** decimals),
      delegateOption: 0,
      delegate: PublicKey.default,
      delegatedAmount: BigInt(0),
      state: 1,
      isNativeOption: 0,
      isNative: BigInt(0),
      closeAuthorityOption: 0,
      closeAuthority: PublicKey.default,
    },
    tokenAccData
  );

  const ata = getAssociatedTokenAddressSync(
    mint,
    recipient,
    true,
    tokenProgram
  );
  const ataAccountInfo = {
    lamports: 1_000_000_000,
    data: tokenAccData,
    owner: tokenProgram,
    executable: false,
  };

  context.setAccount(ata, ataAccountInfo);
}

export async function getOrCreateAtaAddress(
  context: ProgramTestContext,
  mint: PublicKey,
  owner: PublicKey,
  tokenProgram: PublicKey = TOKEN_PROGRAM_ID
): Promise<PublicKey> {
  const ata = getAssociatedTokenAddressSync(mint, owner, true, tokenProgram);

  const fetchedAtaAccountInfo = await context.banksClient.getAccount(ata);

  if (
    fetchedAtaAccountInfo &&
    fetchedAtaAccountInfo.data &&
    fetchedAtaAccountInfo.data.length > 0
  ) {
    return ata;
  }

  const tokenAccData = Buffer.alloc(ACCOUNT_SIZE);
  AccountLayout.encode(
    {
      mint: mint,
      owner: owner,
      amount: BigInt(0),
      delegateOption: 0,
      delegate: PublicKey.default,
      delegatedAmount: BigInt(0),
      state: 1,
      isNativeOption: 0,
      isNative: BigInt(0),
      closeAuthorityOption: 0,
      closeAuthority: PublicKey.default,
    },
    tokenAccData
  );

  const ataAccountInfo = {
    lamports: 1_000_000_000,
    data: tokenAccData,
    owner: tokenProgram,
    executable: false,
  };

  context.setAccount(ata, ataAccountInfo);

  return ata;
}

export async function resetTokenBalance(
  context: ProgramTestContext,
  mint: PublicKey,
  owner: PublicKey
) {
  const ata = getAssociatedTokenAddressSync(mint, owner, true);

  const tokenAccData = Buffer.alloc(ACCOUNT_SIZE);
  AccountLayout.encode(
    {
      mint: mint,
      owner: owner,
      amount: BigInt(0),
      delegateOption: 0,
      delegate: PublicKey.default,
      delegatedAmount: BigInt(0),
      state: 1,
      isNativeOption: 0,
      isNative: BigInt(0),
      closeAuthorityOption: 0,
      closeAuthority: PublicKey.default,
    },
    tokenAccData
  );

  const ataAccountInfo = {
    lamports: 1_000_000_000,
    data: tokenAccData,
    owner: TOKEN_PROGRAM_ID,
    executable: false,
  };

  context.setAccount(ata, ataAccountInfo);
}

export function getAtaAddress(
  mint: PublicKey,
  owner: PublicKey,
  tokenProgram: PublicKey = TOKEN_PROGRAM_ID
) {
  return getAssociatedTokenAddressSync(mint, owner, true, tokenProgram);
}

export async function getTokenBalance(
  client: BanksClient,
  account: PublicKey,
  isNative: boolean = false
): Promise<bigint> {
  if (isNative) {
    return await client.getBalance(account);
  }

  const accountInfo = await client.getAccount(account);

  const tokenAccountInfo = AccountLayout.decode(accountInfo.data);

  return tokenAccountInfo.amount;
}

export async function getMintAuthorities(
  client: BanksClient,
  mint: PublicKey
): Promise<{ mintAuthority: PublicKey; freezeAuthority: PublicKey }> {
  const mintInfo = await client.getAccount(mint);
  const mintData = MintLayout.decode(mintInfo.data);

  return {
    mintAuthority: mintData.mintAuthority,
    freezeAuthority: mintData.freezeAuthority,
  };
}

// Used to get the token balances from a list of mints and owners (for assertions)
export async function getTokenBalancesFromMints(
  context: ProgramTestContext,
  mints: PublicKey[],
  owners: PublicKey[],
  mintsTokenProgram: PublicKey[] = []
): Promise<{ owner: PublicKey; balances: bigint[] }[]> {
  const balances = [];
  for (const owner of owners) {
    const ownerBalances = [];
    for (const [indexOfMint, mint] of mints.entries()) {
      ownerBalances.push(
        await getTokenBalance(
          context.banksClient,
          await getOrCreateAtaAddress(
            context,
            mint,
            owner,
            mintsTokenProgram?.[indexOfMint] ?? TOKEN_PROGRAM_ID
          )
        )
      );
    }
    balances.push({ owner, balances: ownerBalances });
  }

  return balances;
}

// Used to assert the expected token balance changes after an operation for a list of mints and owners
export async function assertExpectedBalancesChanges(
  context: ProgramTestContext,
  beforeBalances: { owner: PublicKey; balances: bigint[] }[],
  mints: PublicKey[],
  owners: PublicKey[],
  // In the order of owner -> mint
  expectedTokenBalanceChanges: BN[],
  mintsTokenProgram: PublicKey[] = []
) {
  const afterBalances = await getTokenBalancesFromMints(
    context,
    mints,
    owners,
    mintsTokenProgram
  );

  for (let j = 0; j < owners.length; j++) {
    const owner = owners[j];
    const beforeBalance = beforeBalances.find((balance) =>
      balance.owner.equals(owner)
    );
    const afterBalance = afterBalances.find((balance) =>
      balance.owner.equals(owner)
    );

    for (let i = 0; i < mints.length; i++) {
      assert.equal(
        afterBalance.balances[i],
        beforeBalance.balances[i] +
          BigInt(expectedTokenBalanceChanges[j * mints.length + i].toString())
      );
    }
  }
}

/*
SPL 2022 related functions
*/
export async function initToken2022Tx(
  context: ProgramTestContext,
  mintAuthority: Keypair,
  mint: Keypair = Keypair.generate(),
  extension: ExtensionType,
  decimals: number = DEFAULT_DECIMALS
) {
  const rent = await context.banksClient.getRent();

  const mintLen = getMintLen(extension ? [extension] : []);

  const createAccountIx = SystemProgram.createAccount({
    fromPubkey: mintAuthority.publicKey,
    newAccountPubkey: mint.publicKey,
    space: mintLen,
    lamports: Number.parseInt(rent.minimumBalance(BigInt(mintLen)).toString()),
    programId: TOKEN_2022_PROGRAM_ID,
  });

  const instructions = [createAccountIx];

  if (extension === ExtensionType.TransferHook) {
    instructions.push(
      createInitializeTransferHookInstruction(
        mint.publicKey,
        mintAuthority.publicKey,
        // programId for the hook, don't really care here
        mintAuthority.publicKey,
        TOKEN_2022_PROGRAM_ID
      )
    );
  } else if (extension === ExtensionType.PermanentDelegate) {
    instructions.push(
      createInitializePermanentDelegateInstruction(
        mint.publicKey,
        mintAuthority.publicKey,
        TOKEN_2022_PROGRAM_ID
      )
    );
  }

  instructions.push(
    createInitializeMint2Instruction(
      mint.publicKey,
      decimals,
      mintAuthority.publicKey,
      mintAuthority.publicKey,
      TOKEN_2022_PROGRAM_ID
    )
  );

  const tx = await createAndProcessTransaction(
    context.banksClient,
    mintAuthority,
    instructions,
    [mintAuthority, mint]
  );

  return tx;
}

export async function mintToken2022Tx(
  context: ProgramTestContext,
  mintAuthority: Keypair,
  mint: PublicKey,
  recipient: PublicKey,
  amount: BN
) {
  const instructions = [];

  const ata = getAssociatedTokenAddressSync(
    mint,
    recipient,
    true,
    TOKEN_2022_PROGRAM_ID
  );

  const account = await context.banksClient.getAccount(ata);
  if (!account) {
    instructions.push(
      createAssociatedTokenAccountInstruction(
        mintAuthority.publicKey,
        ata,
        recipient,
        mint,
        TOKEN_2022_PROGRAM_ID
      )
    );
  }

  instructions.push(
    createMintToInstruction(
      mint,
      ata,
      mintAuthority.publicKey,
      BigInt(amount.toString()),
      [],
      TOKEN_2022_PROGRAM_ID
    )
  );

  const tx = await createAndProcessTransaction(
    context.banksClient,
    mintAuthority,
    instructions,
    [mintAuthority]
  );

  return tx;
}
