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
} from "@solana/spl-token";

import * as assert from "assert";
import { BN } from "@coral-xyz/anchor";

export function initToken(
  context: ProgramTestContext,
  mintAuthority: PublicKey,
  mint: Keypair = Keypair.generate(),
  decimals: number = DEFAULT_DECIMALS
) {
  const mintAccData = Buffer.alloc(MINT_SIZE);
  MintLayout.encode(
    {
      mintAuthorityOption: 1,
      mintAuthority: mintAuthority,
      supply: BigInt(0),
      decimals,
      isInitialized: true,
      freezeAuthorityOption: 0,
      freezeAuthority: PublicKey.default,
    },
    mintAccData
  );

  context.setAccount(mint.publicKey, {
    lamports: 1_000_000_000,
    data: mintAccData,
    owner: TOKEN_PROGRAM_ID,
    executable: false,
  });
}

export function mintToken(
  context: ProgramTestContext,
  mint: PublicKey,
  amount: number,
  receiver: PublicKey,
  decimals: number = DEFAULT_DECIMALS
) {
  const tokenAccData = Buffer.alloc(ACCOUNT_SIZE);
  AccountLayout.encode(
    {
      mint: mint,
      owner: receiver,
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

  const ata = getAssociatedTokenAddressSync(mint, receiver, true);
  const ataAccountInfo = {
    lamports: 1_000_000_000,
    data: tokenAccData,
    owner: TOKEN_PROGRAM_ID,
    executable: false,
  };

  context.setAccount(ata, ataAccountInfo);
}

export async function getOrCreateAtaAddress(
  context: ProgramTestContext,
  mint: PublicKey,
  owner: PublicKey
): Promise<PublicKey> {
  const ata = getAssociatedTokenAddressSync(mint, owner, true);

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
    owner: TOKEN_PROGRAM_ID,
    executable: false,
  };

  context.setAccount(ata, ataAccountInfo);

  return ata;
}

export function getAtaAddress(mint: PublicKey, owner: PublicKey) {
  return getAssociatedTokenAddressSync(mint, owner, true);
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

export async function getTokenBalancesFromMints(
  context: ProgramTestContext,
  mints: PublicKey[],
  owners: PublicKey[]
): Promise<{ owner: PublicKey; balances: bigint[] }[]> {
  const balances = [];
  for (const owner of owners) {
    const ownerBalances = [];
    for (const mint of mints) {
      ownerBalances.push(
        await getTokenBalance(
          context.banksClient,
          await getOrCreateAtaAddress(context, mint, owner)
        )
      );
    }
    balances.push({ owner, balances: ownerBalances });
  }
  return balances;
}

export async function assertExpectedBalancesChanges(
  context: ProgramTestContext,
  beforeBalances: { owner: PublicKey; balances: bigint[] }[],
  mints: PublicKey[],
  owners: PublicKey[],
  // In the order of owner -> mint
  expectedTokenBalanceChanges: BN[]
) {
  const afterBalances = await getTokenBalancesFromMints(context, mints, owners);

  for (const owner of owners) {
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
          BigInt(expectedTokenBalanceChanges[i].toString())
      );
    }
  }
}
