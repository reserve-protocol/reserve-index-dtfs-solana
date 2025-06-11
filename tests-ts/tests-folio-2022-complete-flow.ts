import {
  airdrop,
  getConnectors,
  getSolanaCurrentTime,
} from "../utils/program-helper";
import { BN, Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  addOrUpdateActor,
  addToBasket,
  addToPendingBasket,
  bid,
  burnFolioToken,
  crankFeeDistribution,
  distributeFees,
  initFolio2022,
  mintFolioToken,
  openAuction,
  pokeFolio,
  redeemFromPendingBasket,
  startRebalance,
  updateFolio,
} from "../utils/folio-helper";
import { setDaoFeeConfig } from "../utils/folio-admin-helper";
import {
  getOrCreateAtaAddress,
  getTokenBalance,
  initToken,
  initToken2022,
  mintToken,
} from "../utils/token-helper";
import {
  MAX_TVL_FEE,
  MIN_AUCTION_LENGTH,
  DEFAULT_DECIMALS_MUL,
  MAX_MINT_FEE,
  MAX_FEE_FLOOR,
  FEE_NUMERATOR,
  MAX_TTL,
  D18,
  DEFAULT_DECIMALS_MUL_D18,
  DEFAULT_DECIMALS,
} from "../utils/constants";
import { Folio } from "../target/types/folio";
import {
  getActorPDA,
  getAuctionPDA,
  getDAOFeeConfigPDA,
  getFeeDistributionPDA,
  getFolioBasketPDA,
  getRebalancePDA,
  getTVLFeeRecipientsPDA,
  getUserPendingBasketPDA,
} from "../utils/pda-helper";
import { assert } from "chai";
import {
  getMint,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { FolioAdmin } from "../target/types/folio_admin";
import { TestHelper } from "../utils/test-helper";

/**
 * Tests for the Folio 2022.
 *
 * This test suite will test all the instructions for Folio created with token mint 2022.
 * It will try to:
 * - Init a folio with token mint 2022
 * - Add tokens as admin in the folio, the tokens included will include both token program tokens
 *   and token mint 2022 tokens.
 * - Add tokens to user pending basket.
 * - Mint tokens for a user.
 * - Burn tokens for user.
 * - Redeem tokens from user pending basket.
 * - Update the folio fee config.
 * - Crank fees
 * - Distribute fees
 * - Start an rebalance
 * - Start an auction: where we sell a TokenProgram mint with Token2022 program mint
 * - Bid and execute the auction.
 */
const INITIAL_TOKEN_IN_BASKET = 10;
const INITIAL_TOKEN_2022_IN_BASKET = 10;
describe("Folio Tests | Complete flow with Token2022", () => {
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
  let programFolioAdmin: Program<FolioAdmin>;
  const newFeeRecipient = [
    {
      recipient: Keypair.generate().publicKey,
      portion: new BN(6).mul(DEFAULT_DECIMALS_MUL_D18).div(new BN(10)),
    },
    {
      recipient: Keypair.generate().publicKey,
      portion: new BN(4).mul(DEFAULT_DECIMALS_MUL_D18).div(new BN(10)),
    },
  ];

  const BATCH_SIZE = 5;

  const feeRecipient: PublicKey = Keypair.generate().publicKey;

  const tokenMints = Array.from({ length: INITIAL_TOKEN_IN_BASKET }, (i) => ({
    mint: Keypair.generate(),
    decimals: DEFAULT_DECIMALS,
  }));

  const token2022Mints = Array.from(
    { length: INITIAL_TOKEN_2022_IN_BASKET },
    () => ({
      mint: Keypair.generate(),
      decimals: DEFAULT_DECIMALS,
    })
  );

  let currentFeeDistributionIndex: BN = new BN(0);

  function getAndIncreaseCurrentFeeDistributionIndex() {
    const index = new BN(currentFeeDistributionIndex);
    currentFeeDistributionIndex = currentFeeDistributionIndex.add(new BN(1));
    return index;
  }
  let buyMint2022: Keypair;
  let sellMint: Keypair;

  let folioTestHelper: TestHelper;

  before(async () => {
    ({ connection, programFolio, programFolioAdmin, keys } =
      await getConnectors());

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
    folioPDA = await initFolio2022(
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
          110000000,
          userKeypair.publicKey
        );
      })
    );
    buyMint2022 = Keypair.generate();
    await Promise.all(
      token2022Mints
        .concat([{ mint: buyMint2022, decimals: DEFAULT_DECIMALS }])
        .map(async (tokenMint) => {
          await initToken2022(
            connection,
            adminKeypair,
            tokenMint.mint,
            tokenMint.decimals // to test different decimals
          );
          await mintToken(
            connection,
            adminKeypair,
            tokenMint.mint.publicKey,
            1_00000,
            folioOwnerKeypair.publicKey,
            undefined,
            TOKEN_2022_PROGRAM_ID
          );

          await mintToken(
            connection,
            adminKeypair,
            tokenMint.mint.publicKey,
            1_000,
            userKeypair.publicKey,
            undefined,
            TOKEN_2022_PROGRAM_ID
          );
        })
    );
    sellMint = tokenMints[0].mint;

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
          return addToBasket(
            connection,
            folioOwnerKeypair,
            folioPDA,
            batch,
            null,
            folioTokenMint.publicKey,
            TOKEN_PROGRAM_ID,
            TOKEN_2022_PROGRAM_ID
          );
        }
      )
    );
    await Promise.all(
      Array.from(
        { length: Math.ceil(token2022Mints.length / BATCH_SIZE) },
        (_, index) => {
          const start = index * BATCH_SIZE;
          const batch = token2022Mints
            .slice(start, start + BATCH_SIZE)
            .map((token) => ({
              mint: token.mint.publicKey,
              amount: new BN(100 * 10 ** token.decimals),
            }));

          const isLastBatch = start + BATCH_SIZE >= token2022Mints.length;
          return addToBasket(
            connection,
            folioOwnerKeypair,
            folioPDA,
            batch,
            isLastBatch ? new BN(10 * DEFAULT_DECIMALS_MUL) : null, // 10 shares, mint decimals for folio token is 9
            folioTokenMint.publicKey,
            TOKEN_2022_PROGRAM_ID,
            TOKEN_2022_PROGRAM_ID
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

    folioTestHelper = new TestHelper(
      connection,
      payerKeypair,
      programFolio,
      folioPDA,
      folioTokenMint.publicKey,
      userKeypair.publicKey,
      tokenMints
        .map((tokenMint) => ({
          mint: tokenMint.mint.publicKey,
          decimals: tokenMint.decimals,
          programId: TOKEN_PROGRAM_ID,
        }))
        .concat(
          token2022Mints.map((tokenMint) => ({
            mint: tokenMint.mint.publicKey,
            decimals: tokenMint.decimals,
            programId: TOKEN_2022_PROGRAM_ID,
          }))
        )
    );
    folioTestHelper.setFolioTokenMintProgramId(TOKEN_2022_PROGRAM_ID);
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
    await Promise.all(
      Array.from(
        { length: Math.ceil(token2022Mints.length / BATCH_SIZE) },
        (_, index) => {
          const start = index * BATCH_SIZE;
          const batch = token2022Mints
            .slice(start, start + BATCH_SIZE)
            .map((token) => ({
              mint: token.mint.publicKey,
              amount: new BN(100 * 10 ** token.decimals),
            }));

          return addToPendingBasket(
            connection,
            userKeypair,
            folioPDA,
            batch,
            TOKEN_2022_PROGRAM_ID
          );
        }
      )
    );

    await mintFolioToken(
      connection,
      userKeypair,
      folioPDA,
      folioTokenMint.publicKey,
      new BN(3 * DEFAULT_DECIMALS_MUL),
      null,
      TOKEN_2022_PROGRAM_ID
    );
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
      new BN(2 * DEFAULT_DECIMALS_MUL),
      [],
      TOKEN_2022_PROGRAM_ID
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

    const userPendingBasket =
      await programFolio.account.userPendingBasket.fetch(
        getUserPendingBasketPDA(folioPDA, userKeypair.publicKey)
      );

    // Redeem from pending basket.
    await Promise.all(
      Array.from(
        { length: Math.ceil(tokenMints.length / BATCH_SIZE) },
        (_, index) => {
          const start = index * BATCH_SIZE;
          const batch = tokenMints
            .slice(start, start + BATCH_SIZE)
            .map((token) => {
              const amount = userPendingBasket.basket.tokenAmounts.find(
                (tokenInBasket) =>
                  tokenInBasket.mint.equals(token.mint.publicKey)
              )?.amountForRedeeming;
              return {
                mint: token.mint.publicKey,
                amount,
              };
            });

          return redeemFromPendingBasket(
            connection,
            userKeypair,
            folioPDA,
            batch
          );
        }
      )
    );
    await Promise.all(
      Array.from(
        { length: Math.ceil(token2022Mints.length / BATCH_SIZE) },
        (_, index) => {
          const start = index * BATCH_SIZE;
          const batch = token2022Mints
            .slice(start, start + BATCH_SIZE)
            .map((token) => {
              const amount = userPendingBasket.basket.tokenAmounts.find(
                (tokenInBasket) =>
                  tokenInBasket.mint.equals(token.mint.publicKey)
              )?.amountForRedeeming;
              return {
                mint: token.mint.publicKey,
                amount,
              };
            });

          return redeemFromPendingBasket(
            connection,
            userKeypair,
            folioPDA,
            batch,
            TOKEN_2022_PROGRAM_ID
          );
        }
      )
    );
    const userPendingBasketAfter =
      await programFolio.account.userPendingBasket.fetch(
        getUserPendingBasketPDA(folioPDA, userKeypair.publicKey)
      );
    for (let i = 0; i < tokenMints.length; i++) {
      const tokenAmountAfter = userPendingBasketAfter.basket.tokenAmounts[i];
      if (tokenAmountAfter.mint.equals(PublicKey.default)) {
        continue;
      }
      assert.equal(tokenAmountAfter.amountForRedeeming.eq(new BN(0)), true);
    }
  });

  it("should allow user to poke folio and update pending fees", async () => {
    const folioBefore = await programFolio.account.folio.fetch(folioPDA);
    // Wait for 1 second to ensure the pokeFolio updates the fees,
    // otherwise the test is flaky
    await new Promise((resolve) => setTimeout(resolve, 1000));

    await pokeFolio(
      connection,
      userKeypair,
      folioPDA,
      folioTokenMint.publicKey
    );

    const folioAfter = await programFolio.account.folio.fetch(folioPDA);

    // Values will not change, unless the test has a sleep for 24 hours, or 1 day is passed after creation of folio, i.e folio created at 11:59:50 UTC
    // and this test executes 10 seconds after 12:00:00 UTC
    assert.equal(
      folioAfter.daoPendingFeeShares.gte(folioBefore.daoPendingFeeShares),
      true
    );
    assert.equal(
      folioAfter.feeRecipientsPendingFeeShares.gte(
        folioBefore.feeRecipientsPendingFeeShares
      ),
      true
    );
  });

  it("should update fee per second of folio", async () => {
    const folioBefore = await programFolio.account.folio.fetch(folioPDA);
    const feeRecipientsBefore =
      await programFolio.account.feeRecipients.fetchNullable(
        getTVLFeeRecipientsPDA(folioPDA)
      );

    await updateFolio(
      connection,
      folioOwnerKeypair,
      folioPDA,
      folioTokenMint.publicKey,
      feeRecipient,
      folioBefore.tvlFee.sub(new BN(1)),
      // Won't get distributed here since fee recipients aren't created
      getAndIncreaseCurrentFeeDistributionIndex(),
      null,
      null,
      [],
      [],
      null,
      TOKEN_2022_PROGRAM_ID
    );

    const folioAfter = await programFolio.account.folio.fetch(folioPDA);
    const feeRecipientsAfter = await programFolio.account.feeRecipients.fetch(
      getTVLFeeRecipientsPDA(folioPDA)
    );

    assert.equal(folioAfter.tvlFee.eq(folioBefore.tvlFee), false);
    assert.equal(null, feeRecipientsBefore);
    assert.notEqual(null, feeRecipientsAfter);

    // Reset TVL Fee and update fee recipients
    await updateFolio(
      connection,
      folioOwnerKeypair,
      folioPDA,
      folioTokenMint.publicKey,
      feeRecipient,
      // This will put the tvl fee lower, as we're calling set_tvl_fee which does calculations
      folioBefore.tvlFee,
      getAndIncreaseCurrentFeeDistributionIndex(),
      null,
      null,
      newFeeRecipient,
      [],
      null,
      TOKEN_2022_PROGRAM_ID
    );
  });

  it("should allow user to distribute fees", async () => {
    const daoFeeConfig = await programFolioAdmin.account.daoFeeConfig.fetch(
      getDAOFeeConfigPDA()
    );

    const feeRecipientBefore = await programFolio.account.feeRecipients.fetch(
      getTVLFeeRecipientsPDA(folioPDA)
    );

    const daoFeeRecipientATA = await getOrCreateAtaAddress(
      connection,
      folioTokenMint.publicKey,
      userKeypair,
      daoFeeConfig.feeRecipient,
      TOKEN_2022_PROGRAM_ID
    );

    const balanceDaoFeeRecipientBefore = await getTokenBalance(
      connection,
      daoFeeRecipientATA
    );

    const index = getAndIncreaseCurrentFeeDistributionIndex();

    await distributeFees(
      connection,
      userKeypair,
      folioPDA,
      folioTokenMint.publicKey,
      daoFeeRecipientATA,
      index,
      TOKEN_2022_PROGRAM_ID
    );

    const feeDistribution = await programFolio.account.feeDistribution.fetch(
      getFeeDistributionPDA(folioPDA, index)
    );
    const folioAfter = await programFolio.account.folio.fetch(folioPDA);

    const feeRecipientAfter = await programFolio.account.feeRecipients.fetch(
      getTVLFeeRecipientsPDA(folioPDA)
    );

    const balanceDaoFeeRecipientAfter = await getTokenBalance(
      connection,
      daoFeeRecipientATA
    );

    // Balance of dao fee recipient should be increased by the amount of fees distributed
    assert.equal(
      balanceDaoFeeRecipientAfter >= balanceDaoFeeRecipientBefore,
      true
    );

    // Folio fees should be as 0 (distributed)
    assert.equal(folioAfter.feeRecipientsPendingFeeShares.eq(new BN(0)), true);
    // Lower than 1 in 1e9, as we use 1e18 precision, so there could be dust left
    assert.equal(
      folioAfter.daoPendingFeeShares.div(new BN(10 ** 9)).lt(new BN(1)),
      true
    );

    // Fee recipient's index should be updated
    assert.equal(
      feeRecipientAfter.distributionIndex.toNumber(),
      feeRecipientBefore.distributionIndex.toNumber() + 1
    );

    // Folio distribution should be created
    assert.equal(feeDistribution.index.toNumber(), index.toNumber());
    assert.equal(feeDistribution.amountToDistribute.gte(new BN(0)), true);
    assert.deepEqual(feeDistribution.folio, folioPDA);
    assert.deepEqual(feeDistribution.cranker, userKeypair.publicKey);
    assert.equal(
      feeDistribution.feeRecipientsState[0].recipient.toBase58(),
      newFeeRecipient[0].recipient.toBase58()
    );
    assert.equal(
      feeDistribution.feeRecipientsState[1].recipient.toBase58(),
      newFeeRecipient[1].recipient.toBase58()
    );
  });

  it("should allow user to crank fee distribution", async () => {
    const newRecipient1ATA = await getOrCreateAtaAddress(
      connection,
      folioTokenMint.publicKey,
      userKeypair,
      newFeeRecipient[0].recipient,
      TOKEN_2022_PROGRAM_ID
    );
    const newRecipient2ATA = await getOrCreateAtaAddress(
      connection,
      folioTokenMint.publicKey,
      userKeypair,
      newFeeRecipient[1].recipient,
      TOKEN_2022_PROGRAM_ID
    );
    const previousFeeDistributionindex = currentFeeDistributionIndex.sub(
      new BN(1)
    );

    const feeDistributionBefore =
      await programFolio.account.feeDistribution.fetch(
        getFeeDistributionPDA(folioPDA, previousFeeDistributionindex)
      );

    const balanceNewRecipient1Before = await getTokenBalance(
      connection,
      newRecipient1ATA
    );
    const balanceNewRecipient2Before = await getTokenBalance(
      connection,
      newRecipient2ATA
    );

    await crankFeeDistribution(
      connection,
      userKeypair,
      folioPDA,
      folioTokenMint.publicKey,
      userKeypair.publicKey,
      previousFeeDistributionindex,
      [new BN(0), new BN(1)],
      [newRecipient1ATA, newRecipient2ATA],
      TOKEN_2022_PROGRAM_ID
    );

    const balanceNewRecipient1After = await getTokenBalance(
      connection,
      newRecipient1ATA
    );
    const balanceNewRecipient2After = await getTokenBalance(
      connection,
      newRecipient2ATA
    );

    const feeDistributionAfter =
      await programFolio.account.feeDistribution.fetchNullable(
        getFeeDistributionPDA(folioPDA, previousFeeDistributionindex)
      );

    // Balances should be updated for both fee recipients
    assert.equal(balanceNewRecipient1After >= balanceNewRecipient1Before, true);
    assert.equal(balanceNewRecipient2After >= balanceNewRecipient2Before, true);

    // Fee distribution should be closed
    assert.notEqual(feeDistributionBefore, null);
    assert.equal(feeDistributionAfter, null);
  });

  it("should add rebalance manager", async () => {
    await addOrUpdateActor(
      connection,
      folioOwnerKeypair,
      folioPDA,
      rebalanceManagerKeypair.publicKey,
      {
        rebalanceManager: {},
      }
    );

    const actor = await programFolio.account.actor.fetch(
      getActorPDA(rebalanceManagerKeypair.publicKey, folioPDA)
    );

    assert.deepEqual(actor.roles, 2); //  binary 10 = 2 for rebalance manager
    assert.deepEqual(actor.authority, rebalanceManagerKeypair.publicKey);
    assert.deepEqual(actor.folio, folioPDA);
    assert.notEqual(actor.bump, 0);
  });

  it("should allow user to start rebalance", async () => {
    const currentTimeOnSolana = await getSolanaCurrentTime(connection);

    const ttl = MAX_TTL;

    const auctionLauncherWindow = 1;
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
            high: new BN(1),
          },
          limits: {
            low: new BN(1),
            spot: new BN(200000).mul(D18),
            high: new BN(200000).mul(D18),
          },
        },
        {
          prices: {
            low: new BN(1),
            high: new BN(1),
          },
          limits: {
            low: new BN(0),
            spot: new BN(0),
            high: new BN(0),
          },
        },
      ],
      true,
      [buyMint2022.publicKey, sellMint.publicKey]
    );

    const rebalance = await programFolio.account.rebalance.fetch(
      getRebalancePDA(folioPDA)
    );
    assert.equal(rebalance.nonce.toNumber(), 1);
    TestHelper.assertTime(rebalance.startedAt, new BN(currentTimeOnSolana));

    TestHelper.assertTime(
      rebalance.restrictedUntil,
      new BN(currentTimeOnSolana + auctionLauncherWindow)
    );
    TestHelper.assertTime(
      rebalance.availableUntil,
      new BN(currentTimeOnSolana + ttl.toNumber())
    );
    assert.equal(
      rebalance.details.tokens[0].mint.toBase58(),
      buyMint2022.publicKey.toBase58()
    );
    assert.equal(
      rebalance.details.tokens[1].mint.toBase58(),
      sellMint.publicKey.toBase58()
    );

    assert.equal(rebalance.details.tokens[0].prices.low.eq(new BN(1)), true);
    assert.equal(rebalance.details.tokens[0].prices.high.eq(new BN(1)), true);
    assert.equal(rebalance.details.tokens[1].prices.low.eq(new BN(1)), true);
    assert.equal(rebalance.details.tokens[1].prices.high.eq(new BN(1)), true);
    assert.equal(
      rebalance.details.tokens[2].mint.toBase58(),
      PublicKey.default.toBase58()
    );
  });

  it("should add auction launcher role to rebalance manager", async () => {
    await addOrUpdateActor(
      connection,
      folioOwnerKeypair,
      folioPDA,
      rebalanceManagerKeypair.publicKey,
      {
        auctionLauncher: {},
      }
    );

    const actor = await programFolio.account.actor.fetch(
      getActorPDA(rebalanceManagerKeypair.publicKey, folioPDA)
    );

    assert.deepEqual(actor.roles, 6); //  binary 110 = 6 for rebalance manager and auction launcher
    assert.deepEqual(actor.authority, rebalanceManagerKeypair.publicKey);
    assert.deepEqual(actor.folio, folioPDA);
    assert.notEqual(actor.bump, 0);
  });

  it("should allow user to open auction", async () => {
    const rebalance = await programFolio.account.rebalance.fetch(
      getRebalancePDA(folioPDA)
    );
    const auctionPDA = getAuctionPDA(folioPDA, rebalance.nonce, new BN(1));
    const folio = await programFolio.account.folio.fetch(folioPDA);

    const currentTimeOnSolana = await getSolanaCurrentTime(connection);

    await openAuction(
      connection,
      rebalanceManagerKeypair,
      folioPDA,
      folioTokenMint.publicKey,
      auctionPDA,
      rebalance.nonce,
      new BN(0),
      new BN(100000).mul(D18),
      new BN(1).mul(D18),
      new BN(1).mul(D18),
      sellMint.publicKey,
      buyMint2022.publicKey
    );

    const auction = await programFolio.account.auction.fetch(auctionPDA);

    assert.equal(auction.sellLimit.eq(new BN(0)), true);
    assert.equal(auction.buyLimit.eq(new BN(100000).mul(D18)), true);
    assert.equal(auction.prices.start.eq(new BN(1).mul(D18)), true);
    assert.equal(auction.prices.end.eq(new BN(1).mul(D18)), true);
    TestHelper.assertTime(auction.start, new BN(currentTimeOnSolana));
    TestHelper.assertTime(
      auction.end,
      new BN(currentTimeOnSolana + folio.auctionLength.toNumber())
    );
    assert.equal(auction.sellMint.toBase58(), sellMint.publicKey.toBase58());
    assert.equal(auction.buyMint.toBase58(), buyMint2022.publicKey.toBase58());
  });

  it("should allow user to bid without callback", async () => {
    const rebalance = await programFolio.account.rebalance.fetch(
      getRebalancePDA(folioPDA)
    );
    const auctionPDA = getAuctionPDA(folioPDA, rebalance.nonce, new BN(1));
    const auctionFetched = await programFolio.account.auction.fetch(auctionPDA);

    const buyMint = await getMint(
      connection,
      auctionFetched.buyMint,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    const sellMint = await getMint(connection, auctionFetched.sellMint);

    folioTestHelper.setTokenMints([
      {
        mint: buyMint.address,
        decimals: buyMint.decimals,
        programId: TOKEN_2022_PROGRAM_ID,
      },
      { mint: sellMint.address, decimals: sellMint.decimals },
    ]);
    const balancesBefore = await folioTestHelper.getBalanceSnapshot(
      false,
      false,
      true
    );

    await bid(
      connection,
      userKeypair,
      folioPDA,
      folioTokenMint.publicKey,
      auctionPDA,
      new BN(110000000000),
      new BN(110000000000),
      false,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID, // Buy program Id
      TOKEN_PROGRAM_ID // Sell program Id
    );

    const balancesAfter = await folioTestHelper.getBalanceSnapshot(
      false,
      false,
      true
    );

    folioTestHelper.assertBalanceSnapshot(
      balancesBefore,
      balancesAfter,
      [],
      [
        [
          -110000000000 / DEFAULT_DECIMALS_MUL,
          110000000000 / DEFAULT_DECIMALS_MUL,
        ],
        [
          110000000000 / DEFAULT_DECIMALS_MUL,
          -110000000000 / DEFAULT_DECIMALS_MUL,
        ],
      ],
      [],
      [0, 1],
      true,
      "amountForMinting",
      true
    );
  });
});
