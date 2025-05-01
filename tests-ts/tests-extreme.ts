import { airdrop, getConnectors } from "../utils/program-helper";
import { BN, Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  addOrUpdateActor,
  addToBasket,
  addToPendingBasket,
  burnFolioToken,
  initFolio,
  mintFolioToken,
  openAuction,
  startRebalance,
} from "../utils/folio-helper";
import { setDaoFeeConfig } from "../utils/folio-admin-helper";
import { initToken, mintToken } from "../utils/token-helper";
import {
  MAX_TVL_FEE,
  MIN_AUCTION_LENGTH,
  DEFAULT_DECIMALS_MUL,
  MAX_MINT_FEE,
  MAX_FEE_FLOOR,
  MAX_TOKENS_IN_BASKET,
  FEE_NUMERATOR,
  MAX_TTL,
  D18,
} from "../utils/constants";
import { Folio } from "../target/types/folio";
import {
  getAuctionEndsPDA,
  getAuctionPDA,
  getFolioBasketPDA,
  getRebalancePDA,
} from "../utils/pda-helper";
import { assert } from "chai";

/**
 * Extreme tests for the Folio protocol.
 * These tests are designed to push the limits of the protocol and test its robustness
 * in relation to the number of tokens that can be included in the folio.
 * They are not meant to be run on a regular basis and are more like a stress test.
 */

describe("Extreme Folio Tests", () => {
  let connection: Connection;
  let programFolio: Program<Folio>;
  let keys: any;

  let payerKeypair: Keypair;
  let adminKeypair: Keypair;
  let userKeypair: Keypair;

  let folioOwnerKeypair: Keypair;
  let folioTokenMint: Keypair;
  let folioPDA: PublicKey;
  let rebalanceManagerKeypair: Keypair;

  const BATCH_SIZE = 5;

  const feeRecipient: PublicKey = Keypair.generate().publicKey;

  const tokenMints = Array.from({ length: MAX_TOKENS_IN_BASKET }, () => ({
    mint: Keypair.generate(),
    // To test with different token decimals
    decimals: Math.floor(Math.random() * 10) + 1,
  }));

  before(async () => {
    ({ connection, programFolio, keys } = await getConnectors());

    payerKeypair = Keypair.fromSecretKey(Uint8Array.from(keys.payer));
    adminKeypair = Keypair.fromSecretKey(Uint8Array.from(keys.admin));

    folioOwnerKeypair = Keypair.generate();
    userKeypair = Keypair.generate();
    rebalanceManagerKeypair = Keypair.generate();

    await airdrop(connection, payerKeypair.publicKey, 1000);
    await airdrop(connection, adminKeypair.publicKey, 1000);
    await airdrop(connection, folioOwnerKeypair.publicKey, 1000);
    await airdrop(connection, userKeypair.publicKey, 1000);
    await airdrop(connection, rebalanceManagerKeypair.publicKey, 1000);

    folioTokenMint = Keypair.generate();

    // Init folio related accounts
    folioPDA = await initFolio(
      connection,
      folioOwnerKeypair,
      folioTokenMint,
      MAX_TVL_FEE,
      MAX_MINT_FEE,
      MIN_AUCTION_LENGTH,
      "Test Folio",
      "TFOL",
      "https://test.com",
      "mandate"
    );

    // Create the tokens that can be included in the folio
    await Promise.all(
      tokenMints.map(async (tokenMint) => {
        await initToken(
          connection,
          adminKeypair,
          tokenMint.mint,
          tokenMint.decimals // to test different decimals
        );
        await mintToken(
          connection,
          adminKeypair,
          tokenMint.mint.publicKey,
          1_000,
          folioOwnerKeypair.publicKey
        );

        await mintToken(
          connection,
          adminKeypair,
          tokenMint.mint.publicKey,
          1_000,
          userKeypair.publicKey
        );
      })
    );

    // Add tokens to the folio basket
    await Promise.all(
      Array.from(
        { length: Math.ceil(tokenMints.length / BATCH_SIZE) },
        (_, index) => {
          const start = index * BATCH_SIZE;
          const batch = tokenMints
            .slice(start, start + BATCH_SIZE)
            .map((token) => ({
              mint: token.mint.publicKey,
              amount: new BN(100 * 10 ** token.decimals),
            }));

          const isLastBatch = start + BATCH_SIZE >= tokenMints.length;
          return addToBasket(
            connection,
            folioOwnerKeypair,
            folioPDA,
            batch,
            isLastBatch ? new BN(10 * DEFAULT_DECIMALS_MUL) : null, // 10 shares, mint decimals for folio token is 9
            folioTokenMint.publicKey
          );
        }
      )
    );

    await setDaoFeeConfig(
      connection,
      adminKeypair,
      feeRecipient,
      FEE_NUMERATOR,
      MAX_FEE_FLOOR
    );
  });

  it("should allow user to init his pending basket and mint folio tokens with all token mints we have", async () => {
    await Promise.all(
      Array.from(
        { length: Math.ceil(tokenMints.length / BATCH_SIZE) },
        (_, index) => {
          const start = index * BATCH_SIZE;
          const batch = tokenMints
            .slice(start, start + BATCH_SIZE)
            .map((token) => ({
              mint: token.mint.publicKey,
              amount: new BN(100 * 10 ** token.decimals),
            }));

          return addToPendingBasket(connection, userKeypair, folioPDA, batch);
        }
      )
    );

    await mintFolioToken(
      connection,
      userKeypair,
      folioPDA,
      folioTokenMint.publicKey,
      new BN(3 * DEFAULT_DECIMALS_MUL)
    );
  });

  it("opening auction properly sets mint and end time", async () => {
    await addOrUpdateActor(
      connection,
      folioOwnerKeypair,
      folioPDA,
      rebalanceManagerKeypair.publicKey,
      {
        rebalanceManager: {},
      }
    );

    const sellMint = tokenMints[0].mint.publicKey; // USDC
    const buyMint = tokenMints[1].mint.publicKey; // USDT
    const auctionId = new BN(1);
    const ttl = MAX_TTL;

    const auctionLauncherWindow = 1;

    // Approve auction with id 1
    await startRebalance(
      connection,
      rebalanceManagerKeypair,
      folioPDA,
      folioTokenMint.publicKey,
      auctionLauncherWindow,
      ttl.toNumber(),
      [
        {
          prices: {
            low: new BN(1),
            high: new BN(2),
          },
          limits: {
            low: new BN(1),
            spot: new BN(7000).mul(D18),
            high: new BN(7000).mul(D18),
          },
        },
        {
          prices: {
            low: new BN(1),
            high: new BN(2),
          },
          limits: {
            low: new BN(1),
            spot: new BN(2),
            high: new BN(2),
          },
        },
      ],
      true,
      [buyMint, sellMint]
    );

    await addOrUpdateActor(
      connection,
      folioOwnerKeypair,
      folioPDA,
      rebalanceManagerKeypair.publicKey,
      {
        auctionLauncher: {},
      }
    );
    const rebalance = await programFolio.account.rebalance.fetch(
      getRebalancePDA(folioPDA)
    );

    const auctionPDA = getAuctionPDA(folioPDA, rebalance.nonce, auctionId);

    // Open auction with id 1
    await openAuction(
      connection,
      rebalanceManagerKeypair,
      folioPDA,
      folioTokenMint.publicKey,
      auctionPDA,
      rebalance.nonce,
      new BN(2),
      new BN(7000).mul(D18),
      new BN(2).mul(D18),
      new BN(1).mul(D18),
      sellMint,
      buyMint
    );

    const auctionEnds = getAuctionEndsPDA(
      folioPDA,
      rebalance.nonce,
      sellMint,
      buyMint
    );
    const auctionEndsAccount = await programFolio.account.auctionEnds.fetch(
      auctionEnds
    );

    const compare = sellMint.toBuffer().compare(buyMint.toBuffer());
    let token1 = sellMint;
    let token2 = buyMint;

    if (compare > 0) {
      token1 = buyMint;
      token2 = sellMint;
    }

    assert.isNotNull(auctionEndsAccount);

    assert.strictEqual(
      auctionEndsAccount.tokenMint1.toString(),
      token1.toString()
    );
    assert.strictEqual(
      auctionEndsAccount.tokenMint2.toString(),
      token2.toString()
    );

    assert.notEqual(auctionEndsAccount.endTime.toNumber(), 0);
  });

  it("should burn and increase the user pending basket", async () => {
    const folioBasketBefore = await programFolio.account.folioBasket.fetch(
      getFolioBasketPDA(folioPDA)
    );
    await burnFolioToken(
      connection,
      userKeypair,
      folioPDA,
      folioTokenMint.publicKey,
      new BN(2 * DEFAULT_DECIMALS_MUL)
    );

    const folioBasketAfter = await programFolio.account.folioBasket.fetch(
      getFolioBasketPDA(folioPDA)
    );
    for (let i = 0; i < tokenMints.length; i++) {
      const tokenAmountBefore = folioBasketBefore.basket.tokenAmounts[i];
      if (tokenAmountBefore.mint.equals(PublicKey.default)) {
        continue;
      }
      const tokenAmountAfter = folioBasketAfter.basket.tokenAmounts[i];

      assert.isTrue(
        tokenAmountAfter.amount.lte(tokenAmountBefore.amount),
        `Burn failed: Token ${tokenAmountBefore.mint.toString()} amount after is greater than before.`
      );
    }
  });
});
