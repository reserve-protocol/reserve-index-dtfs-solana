import { Keypair } from "@solana/web3.js";
import { getFolioPendingBasketPDA } from "./pda-helper";

import { getUserPendingBasketPDA } from "./pda-helper";
import { PublicKey } from "@solana/web3.js";
import { Folio } from "../target/types/folio";
import { Program } from "@coral-xyz/anchor";
import { Connection } from "@solana/web3.js";
import { getOrCreateAtaAddress, getTokenBalance } from "./token-helper";
import * as assert from "assert";

export class TestHelper {
  constructor(
    private connection: Connection,
    private payer: Keypair,
    private program: Program<Folio>,
    private folioPDA: PublicKey,
    private folioTokenMint: PublicKey,
    private userPubkey: PublicKey,
    private tokenMints: { mint: Keypair; decimals: number }[]
  ) {
    this.connection = connection;
    this.payer = payer;
    this.program = program;
    this.folioPDA = folioPDA;
    this.folioTokenMint = folioTokenMint;
    this.userPubkey = userPubkey;
    this.tokenMints = tokenMints;
  }

  async getBalanceSnapshot(): Promise<{
    userPendingAmounts: any;
    folioPendingAmounts: any;
    folioTokenBalance?: number;
    userTokenBalance?: number;
    folioTokenBalances?: number[];
    userTokenBalances?: number[];
  }> {
    const userPendingBasketPDA = getUserPendingBasketPDA(
      this.folioPDA,
      this.userPubkey
    );
    const folioPendingBasketPDA = getFolioPendingBasketPDA(this.folioPDA);

    const [userPendingAmounts, folioPendingAmounts] = await Promise.all([
      this.program.account.pendingBasket.fetch(userPendingBasketPDA),
      this.program.account.pendingBasket.fetch(folioPendingBasketPDA),
    ]);

    const userAta = await getOrCreateAtaAddress(
      this.connection,
      this.folioTokenMint,
      this.payer,
      this.userPubkey
    );
    const userBalance = await getTokenBalance(this.connection, userAta);

    const folioAta = await getOrCreateAtaAddress(
      this.connection,
      this.folioTokenMint,
      this.payer,
      this.folioPDA
    );
    const folioBalance = await getTokenBalance(this.connection, folioAta);

    let folioTokenBalances: number[] = [];
    let userTokenBalances: number[] = [];

    for (const token of this.tokenMints) {
      const userTokenAta = await getOrCreateAtaAddress(
        this.connection,
        token.mint.publicKey,
        this.payer,
        this.userPubkey
      );
      userTokenBalances.push(
        await getTokenBalance(this.connection, userTokenAta)
      );

      const folioTokenAta = await getOrCreateAtaAddress(
        this.connection,
        token.mint.publicKey,
        this.payer,
        this.folioPDA
      );
      folioTokenBalances.push(
        await getTokenBalance(this.connection, folioTokenAta)
      );
    }

    return {
      userPendingAmounts,
      folioPendingAmounts,
      folioTokenBalance: folioBalance,
      userTokenBalance: userBalance,
      folioTokenBalances,
      userTokenBalances,
    };
  }

  assertBalanceSnapshot(
    before: any,
    after: any,
    expectedDifferences: number[],
    expectedTokenBalancesDiffs: number[],
    expectedBalancesDifference: number,
    indices: number[],
    property: "amountForMinting" | "amountForRedeeming"
  ) {
    indices.forEach((index) => {
      const diff = expectedDifferences[index];
      assert.equal(
        after.userPendingAmounts.tokenAmounts[index][property].toNumber(),
        before.userPendingAmounts.tokenAmounts[index][property].toNumber() -
          diff
      );
      assert.equal(
        after.folioPendingAmounts.tokenAmounts[index][property].toNumber(),
        before.folioPendingAmounts.tokenAmounts[index][property].toNumber() -
          diff
      );

      assert.equal(
        after.userTokenBalances[index],
        before.userTokenBalances[index] - expectedTokenBalancesDiffs[index]
      );
      assert.equal(
        after.folioTokenBalances[index],
        before.folioTokenBalances[index] - expectedTokenBalancesDiffs[index]
      );
    });

    assert.equal(
      after.folioTokenBalance,
      before.folioTokenBalance - expectedBalancesDifference
    );
    assert.equal(
      after.userTokenBalance,
      before.userTokenBalance - expectedBalancesDifference
    );
  }
}
