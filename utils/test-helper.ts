import { Keypair } from "@solana/web3.js";
import { getFolioBasketPDA } from "./pda-helper";

import { getUserPendingBasketPDA } from "./pda-helper";
import { PublicKey } from "@solana/web3.js";
import { Folio } from "../target/types/folio";
import { Program } from "@coral-xyz/anchor";
import { Connection } from "@solana/web3.js";
import { getOrCreateAtaAddress, getTokenBalance } from "./token-helper";
import * as assert from "assert";

/**
 * Testing utilities for the Folio protocol. Provides methods for tracking and
 * verifying account balances, token amounts, and other state changes during
 * testing operations.
 */

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

  /**
   * Floors a value to the nearest 100.
   * @param value - The value to floor.
   * @returns The floored value.
   */
  floor(value: number) {
    return Math.floor(value / 100) * 100;
  }
  /**
   * Sets the user public key for the test helper to know which balances to pull.
   * @param userPubkey - The public key of the user to set.
   */
  setUserPubkey(userPubkey: PublicKey) {
    this.userPubkey = userPubkey;
  }

  /**
   * Sets the token mints for the test helper to know which balances to pull.
   * @param tokenMints - The token mints to set.
   */
  setTokenMints(tokenMints: { mint: PublicKey; decimals: number }[]) {
    this.tokenMints = tokenMints;
  }

  /**
   * Gets the balance snapshot for the test helper.
   * @param includePendingAmounts - Whether to include pending amounts (basket and pending basket).
   * @param includeFolioTokenBalances - Whether to include folio token balances (folio token mint).
   * @param includeTokenBalances - Whether to include token balances (token accounts).
   * @returns The balance snapshot.
   */
  async getBalanceSnapshot(
    includePendingAmounts: boolean,
    includeFolioTokenBalances: boolean,
    includeTokenBalances: boolean
  ): Promise<{
    userPendingAmounts: any;
    folioBasketAmounts: any;
    folioTokenBalance?: number;
    userTokenBalance?: number;
    folioTokenBalances?: number[];
    userTokenBalances?: number[];
  }> {
    let userPendingAmounts: any | undefined = undefined;
    let folioBasketAmounts: any | undefined = undefined;
    let folioTokenBalance: number | undefined = undefined;
    let userTokenBalance: number | undefined = undefined;
    const folioTokenBalances: number[] = [];
    const userTokenBalances: number[] = [];

    if (includePendingAmounts) {
      const userPendingBasketPDA = getUserPendingBasketPDA(
        this.folioPDA,
        this.userPubkey
      );
      const folioBasketPDA = getFolioBasketPDA(this.folioPDA);

      [userPendingAmounts, folioBasketAmounts] = await Promise.all([
        this.program.account.userPendingBasket.fetchNullable(
          userPendingBasketPDA
        ),
        this.program.account.folioBasket.fetchNullable(folioBasketPDA),
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
      folioBasketAmounts,
      folioTokenBalance,
      userTokenBalance,
      folioTokenBalances,
      userTokenBalances,
    };
  }

  /**
   * Asserts the new balance snapshot for the test helper against the previous balance snapshot.
   * @param before - The before balance snapshot.
   * @param after - The after balance snapshot.
   * @param expectedDifferences - The expected differences for the pending amounts.
   * @param expectedTokenBalancesDiffs - The expected token balances differences for the Folio token mint.
   * @param expectedBalancesDifference - The expected balances difference for the token accounts.
   * @param indices - The indices to check.
   * @param property - The property to check for pending amounts, wether amountForMinting or amountForRedeeming.
   * @param isEstimate - Whether to use estimate (will floor the values to the nearest 100).
   */
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
          assert.equal(this.floor(afterValue), this.floor(expectedValue));
        } else {
          assert.equal(afterValue, expectedValue);
        }

        const afterFolioValue =
          after.folioBasketAmounts.tokenAmounts[index][property].toNumber();
        const expectedFolioValue =
          before.folioBasketAmounts.tokenAmounts[index][property].toNumber() +
          expectedDifferences[index][1];

        if (isEstimate) {
          assert.equal(
            this.floor(afterFolioValue),
            this.floor(expectedFolioValue)
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
            this.floor(afterUserValue),
            this.floor(expectedUserValue)
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
            this.floor(afterFolioValue),
            this.floor(expectedFolioValue)
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
          this.floor(afterFolioValue),
          this.floor(expectedFolioValue)
        );
      } else {
        assert.equal(afterFolioValue, expectedFolioValue);
      }

      const afterUserValue = after.userTokenBalance;
      const expectedUserValue =
        before.userTokenBalance + expectedBalancesDifference[1];

      if (isEstimate) {
        assert.equal(this.floor(afterUserValue), this.floor(expectedUserValue));
      } else {
        assert.equal(afterUserValue, expectedUserValue);
      }
    }
  }
}
