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
    private tokenMints: { mint: PublicKey; decimals: number }[]
  ) {
    this.connection = connection;
    this.payer = payer;
    this.program = program;
    this.folioPDA = folioPDA;
    this.folioTokenMint = folioTokenMint;
    this.userPubkey = userPubkey;
    this.tokenMints = tokenMints;
  }

  setUserPubkey(userPubkey: PublicKey) {
    this.userPubkey = userPubkey;
  }

  setTokenMints(tokenMints: { mint: PublicKey; decimals: number }[]) {
    this.tokenMints = tokenMints;
  }

  async getBalanceSnapshot(
    includePendingAmounts: boolean,
    includeFolioTokenBalances: boolean,
    includeTokenBalances: boolean
  ): Promise<{
    userPendingAmounts: any;
    folioPendingAmounts: any;
    folioTokenBalance?: number;
    userTokenBalance?: number;
    folioTokenBalances?: number[];
    userTokenBalances?: number[];
  }> {
    let userPendingAmounts: any | undefined = undefined;
    let folioPendingAmounts: any | undefined = undefined;
    let folioTokenBalance: number | undefined = undefined;
    let userTokenBalance: number | undefined = undefined;
    let folioTokenBalances: number[] = [];
    let userTokenBalances: number[] = [];

    if (includePendingAmounts) {
      const userPendingBasketPDA = getUserPendingBasketPDA(
        this.folioPDA,
        this.userPubkey
      );
      const folioPendingBasketPDA = getFolioPendingBasketPDA(this.folioPDA);

      [userPendingAmounts, folioPendingAmounts] = await Promise.all([
        this.program.account.pendingBasket.fetchNullable(userPendingBasketPDA),
        this.program.account.pendingBasket.fetchNullable(folioPendingBasketPDA),
      ]);
    }

    if (includeFolioTokenBalances) {
      const userAta = await getOrCreateAtaAddress(
        this.connection,
        this.folioTokenMint,
        this.payer,
        this.userPubkey
      );
      userTokenBalance = await getTokenBalance(this.connection, userAta);

      const folioAta = await getOrCreateAtaAddress(
        this.connection,
        this.folioTokenMint,
        this.payer,
        this.folioPDA
      );
      folioTokenBalance = await getTokenBalance(this.connection, folioAta);
    }

    if (includeTokenBalances) {
      for (const token of this.tokenMints) {
        const userTokenAta = await getOrCreateAtaAddress(
          this.connection,
          token.mint,
          this.payer,
          this.userPubkey
        );
        userTokenBalances.push(
          await getTokenBalance(this.connection, userTokenAta)
        );

        const folioTokenAta = await getOrCreateAtaAddress(
          this.connection,
          token.mint,
          this.payer,
          this.folioPDA
        );
        folioTokenBalances.push(
          await getTokenBalance(this.connection, folioTokenAta)
        );
      }
    }

    return {
      userPendingAmounts,
      folioPendingAmounts,
      folioTokenBalance,
      userTokenBalance,
      folioTokenBalances,
      userTokenBalances,
    };
  }

  assertBalanceSnapshot(
    before: any,
    after: any,
    expectedDifferences: number[][],
    expectedTokenBalancesDiffs: number[][],
    expectedBalancesDifference: number[],
    indices: number[],
    property: "amountForMinting" | "amountForRedeeming" = "amountForMinting",
    isEstimate: boolean = false
  ) {
    if (expectedDifferences.length > 0) {
      indices.forEach((index) => {
        const afterValue =
          after.userPendingAmounts.tokenAmounts[index][property].toNumber();
        const expectedValue =
          before.userPendingAmounts.tokenAmounts[index][property].toNumber() +
          expectedDifferences[index][0];

        if (isEstimate) {
          assert.equal(Math.floor(afterValue), Math.floor(expectedValue));
        } else {
          assert.equal(afterValue, expectedValue);
        }

        const afterFolioValue =
          after.folioPendingAmounts.tokenAmounts[index][property].toNumber();
        const expectedFolioValue =
          before.folioPendingAmounts.tokenAmounts[index][property].toNumber() +
          expectedDifferences[index][1];

        if (isEstimate) {
          assert.equal(
            Math.floor(afterFolioValue),
            Math.floor(expectedFolioValue)
          );
        } else {
          assert.equal(afterFolioValue, expectedFolioValue);
        }
      });
    }

    if (expectedTokenBalancesDiffs.length > 0) {
      indices.forEach((index) => {
        const afterUserValue = after.userTokenBalances[index];
        const expectedUserValue =
          before.userTokenBalances[index] +
          expectedTokenBalancesDiffs[index][0];

        if (isEstimate) {
          assert.equal(
            Math.floor(afterUserValue),
            Math.floor(expectedUserValue)
          );
        } else {
          assert.equal(afterUserValue, expectedUserValue);
        }

        const afterFolioValue = after.folioTokenBalances[index];
        const expectedFolioValue =
          before.folioTokenBalances[index] +
          expectedTokenBalancesDiffs[index][1];

        if (isEstimate) {
          assert.equal(
            Math.floor(afterFolioValue),
            Math.floor(expectedFolioValue)
          );
        } else {
          assert.equal(afterFolioValue, expectedFolioValue);
        }
      });
    }

    if (expectedBalancesDifference.length > 0) {
      const afterFolioValue = after.folioTokenBalance;
      const expectedFolioValue =
        before.folioTokenBalance + expectedBalancesDifference[0];

      if (isEstimate) {
        assert.equal(
          Math.floor(afterFolioValue * 100) / 100,
          Math.floor(expectedFolioValue * 100) / 100
        );
      } else {
        assert.equal(afterFolioValue, expectedFolioValue);
      }

      const afterUserValue = after.userTokenBalance;
      const expectedUserValue =
        before.userTokenBalance + expectedBalancesDifference[1];

      if (isEstimate) {
        assert.equal(
          Math.floor(afterUserValue * 100) / 100,
          Math.floor(expectedUserValue * 100) / 100
        );
      } else {
        assert.equal(afterUserValue, expectedUserValue);
      }
    }
  }
}
