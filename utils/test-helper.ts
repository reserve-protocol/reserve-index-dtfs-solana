import { Keypair } from "@solana/web3.js";
import { getFolioBasketPDA } from "./pda-helper";

import { getUserPendingBasketPDA } from "./pda-helper";
import { PublicKey } from "@solana/web3.js";
import { Folio } from "../target/types/folio";
import { BN, Program } from "@coral-xyz/anchor";
import { Connection } from "@solana/web3.js";
import { getOrCreateAtaAddress, getTokenBalance } from "./token-helper";
import * as assert from "assert";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

/**
 * Testing utilities for the Folio protocol. Provides methods for tracking and
 * verifying account balances, token amounts, and other state changes during
 * testing operations.
 */

export class TestHelper {
  private folioTokenMintProgramId: PublicKey;
  constructor(
    private connection: Connection,
    private payer: Keypair,
    private program: Program<Folio>,
    private folioPDA: PublicKey,
    private folioTokenMint: PublicKey,
    private userPubkey: PublicKey,
    private tokenMints: {
      mint: PublicKey;
      decimals: number;
      programId: PublicKey;
    }[]
  ) {
    this.connection = connection;
    this.payer = payer;
    this.program = program;
    this.folioPDA = folioPDA;
    this.folioTokenMint = folioTokenMint;
    this.userPubkey = userPubkey;
    this.tokenMints = tokenMints;
    this.folioTokenMintProgramId = TOKEN_PROGRAM_ID;
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
   * Sets the folio token mint program id for the test helper to know which balances to pull.
   * @param folioTokenMintProgramId - The program id of the folio token mint.
   */
  setFolioTokenMintProgramId(folioTokenMintProgramId: PublicKey) {
    this.folioTokenMintProgramId = folioTokenMintProgramId;
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
  setTokenMints(
    tokenMints: { mint: PublicKey; decimals: number; programId?: PublicKey }[]
  ) {
    this.tokenMints = tokenMints.map((tokenMint) => ({
      mint: tokenMint.mint,
      decimals: tokenMint.decimals,
      programId: tokenMint.programId || TOKEN_PROGRAM_ID,
    }));
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
        this.userPubkey,
        this.folioTokenMintProgramId
      );
      userTokenBalance = await getTokenBalance(this.connection, userAta);

      const folioAta = await getOrCreateAtaAddress(
        this.connection,
        this.folioTokenMint,
        this.payer,
        this.folioPDA,
        this.folioTokenMintProgramId
      );
      folioTokenBalance = await getTokenBalance(this.connection, folioAta);
    }

    if (includeTokenBalances) {
      for (const token of this.tokenMints) {
        const userTokenAta = await getOrCreateAtaAddress(
          this.connection,
          token.mint,
          this.payer,
          this.userPubkey,
          token.programId
        );
        userTokenBalances.push(
          await getTokenBalance(this.connection, userTokenAta)
        );

        const folioTokenAta = await getOrCreateAtaAddress(
          this.connection,
          token.mint,
          this.payer,
          this.folioPDA,
          token.programId
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
   * @param folioBasketChanged - Whether the Folio basket changed.
   * @param rawFolioShares - The raw folio shares to mint.
   * @param isEstimate - Whether to use estimate (will floor the values to the nearest 100).
   * @param investmentsBeforeSnapshotsInPendingBasket - The investments before snapshots in the pending basket.
   */
  assertBalanceSnapshot(
    before: any,
    after: any,
    expectedDifferences: number[][],
    expectedTokenBalancesDiffs: number[][],
    expectedBalancesDifference: number[],
    indices: number[],
    folioBasketChanged: boolean,
    property: "amountForMinting" | "amountForRedeeming" = "amountForMinting",
    isEstimate: boolean = false,
    expectedFolioBasketTokenChanges: number[] | null = null
  ) {
    if (expectedDifferences.length > 0) {
      indices.forEach((index) => {
        const afterValue =
          after.userPendingAmounts.basket.tokenAmounts[index][
            property
          ].toNumber();
        const expectedValue =
          before.userPendingAmounts.basket.tokenAmounts[index][
            property
          ].toNumber() + expectedDifferences[index][0];

        if (isEstimate) {
          assert.equal(this.floor(afterValue), this.floor(expectedValue));
        } else {
          assert.equal(afterValue, expectedValue);
        }

        const afterFolioValue =
          after.folioBasketAmounts.basket.tokenAmounts[index].amount.toNumber();
        const beforeFolioValue =
          before.folioBasketAmounts.basket.tokenAmounts[
            index
          ].amount.toNumber();
        if (folioBasketChanged) {
          const expectedDifference = expectedDifferences[index][1];
          let expectedFolioValue =
            property === "amountForMinting"
              ? beforeFolioValue + expectedDifference
              : beforeFolioValue - expectedDifference;
          if (expectedFolioBasketTokenChanges) {
            expectedFolioValue = expectedFolioBasketTokenChanges[index];
          }

          if (isEstimate) {
            assert.equal(
              this.floor(afterFolioValue),
              this.floor(expectedFolioValue)
            );
          } else {
            assert.equal(afterFolioValue, expectedFolioValue);
          }
        } else {
          assert.equal(afterFolioValue, beforeFolioValue);
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

  /**
   * Asserts the time is between the expected time and the expected time plus 100.
   * @param time - The time to check.
   * @param expectedTime - The expected time.
   */
  static assertTime(time: BN, expectedTime: BN) {
    assert.equal(time.gte(expectedTime), true);
    assert.equal(time.lt(expectedTime.add(new BN(100))), true);
  }
}
