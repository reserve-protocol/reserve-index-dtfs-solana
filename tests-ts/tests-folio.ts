import {
  airdrop,
  assertThrows,
  getConnectors,
  getSolanaCurrentTime,
  wait,
} from "../utils/program-helper";
import { Folio } from "../target/types/folio";
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
  initFolio,
  killAuction,
  mintFolioToken,
  openAuction,
  pokeFolio,
  redeemFromPendingBasket,
  removeActor,
  removeFromPendingBasket,
  startRebalance,
  updateFolio,
} from "../utils/folio-helper";
import * as assert from "assert";

import {
  getActorPDA,
  getDAOFeeConfigPDA,
  getFeeDistributionPDA,
  getTVLFeeRecipientsPDA,
  getAuctionPDA,
  getUserPendingBasketPDA,
  getRebalancePDA,
  getAuctionEndsPDA,
} from "../utils/pda-helper";
import {
  DEFAULT_DECIMALS_MUL,
  MAX_AUCTION_LENGTH,
  MAX_TVL_FEE,
  MAX_TTL,
  MAX_MINT_FEE,
  MAX_FEE_FLOOR,
  EXPECTED_TVL_FEE_WHEN_MAX,
  DEFAULT_DECIMALS_MUL_D18,
  DEFAULT_DECIMALS,
  FEE_NUMERATOR,
  D18,
} from "../utils/constants";
import { TestHelper } from "../utils/test-helper";
import {
  getOrCreateAtaAddress,
  getTokenBalance,
  initToken,
  mintToken,
} from "../utils/token-helper";
import {
  createTransferInstruction,
  getMint,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { setDaoFeeConfig } from "../utils/folio-admin-helper";
import { FolioAdmin } from "../target/types/folio_admin";

/**
 * Tests for the Folio program.
 * These tests are designed to test the functionality of the Folio program from
 * initializing the folio to adding tokens to the basket. Auctions to fees.
 */

describe("Folio Tests", () => {
  let connection: Connection;
  let programFolio: Program<Folio>;
  let programFolioAdmin: Program<FolioAdmin>;
  let keys: any;

  let payerKeypair: Keypair;
  let adminKeypair: Keypair;
  let userKeypair: Keypair;

  let auctionLauncherKeypair: Keypair;
  let rebalanceManagerKeypair: Keypair;

  let folioOwnerKeypair: Keypair;
  let folioTokenMint: Keypair;
  let folioPDA: PublicKey;

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

  let folioTestHelper: TestHelper;

  /*
  Tokens that can be included in the folio
  */
  const tokenMints = [
    { mint: Keypair.generate(), decimals: DEFAULT_DECIMALS },
    { mint: Keypair.generate(), decimals: DEFAULT_DECIMALS },
    { mint: Keypair.generate(), decimals: 5 },
    { mint: Keypair.generate(), decimals: DEFAULT_DECIMALS },
    { mint: Keypair.generate(), decimals: DEFAULT_DECIMALS },
  ];

  let buyMint: Keypair;

  const feeRecipient: PublicKey = Keypair.generate().publicKey;

  let currentFeeDistributionIndex: BN = new BN(0);

  function getAndIncreaseCurrentFeeDistributionIndex() {
    const index = currentFeeDistributionIndex;
    currentFeeDistributionIndex = currentFeeDistributionIndex.add(new BN(1));
    return index;
  }

  before(async () => {
    ({ connection, programFolio, programFolioAdmin, keys } =
      await getConnectors());

    payerKeypair = Keypair.fromSecretKey(Uint8Array.from(keys.payer));
    adminKeypair = Keypair.fromSecretKey(Uint8Array.from(keys.admin));

    folioTokenMint = Keypair.generate();

    folioOwnerKeypair = Keypair.generate();
    userKeypair = Keypair.generate();
    rebalanceManagerKeypair = Keypair.generate();
    auctionLauncherKeypair = Keypair.generate();

    await airdrop(connection, payerKeypair.publicKey, 1000);
    await airdrop(connection, adminKeypair.publicKey, 1000);
    await airdrop(connection, folioOwnerKeypair.publicKey, 1000);
    await airdrop(connection, userKeypair.publicKey, 1000);
    await airdrop(connection, rebalanceManagerKeypair.publicKey, 1000);
    await airdrop(connection, auctionLauncherKeypair.publicKey, 1000);

    // Create the tokens that can be included in the folio
    for (const tokenMint of tokenMints) {
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
    }

    // Create the token for buy mint
    buyMint = Keypair.generate();
    await initToken(connection, adminKeypair, buyMint);
    await mintToken(
      connection,
      adminKeypair,
      buyMint.publicKey,
      1_000,
      userKeypair.publicKey
    );
    await mintToken(
      connection,
      adminKeypair,
      buyMint.publicKey,
      1_000,
      adminKeypair.publicKey
    );

    // Set dao fee recipient
    await setDaoFeeConfig(
      connection,
      adminKeypair,
      feeRecipient,
      FEE_NUMERATOR,
      MAX_FEE_FLOOR
    );
  });

  it("should initialize a folio", async () => {
    folioPDA = await initFolio(
      connection,
      folioOwnerKeypair,
      folioTokenMint,
      MAX_TVL_FEE,
      MAX_MINT_FEE,
      MAX_AUCTION_LENGTH,
      "Test Folio",
      "TFOL",
      "https://test.com",
      "mandate"
    );

    const folio = await programFolio.account.folio.fetch(folioPDA);

    const feeRecipients =
      await programFolio.account.feeRecipients.fetchNullable(
        getTVLFeeRecipientsPDA(folioPDA)
      );

    assert.notEqual(folio.bump, 0);
    assert.equal(folio.tvlFee.eq(EXPECTED_TVL_FEE_WHEN_MAX), true);
    assert.equal(folio.mintFee.eq(MAX_MINT_FEE), true);
    assert.deepEqual(folio.folioTokenMint, folioTokenMint.publicKey);
    assert.equal(feeRecipients, null);
    assert.equal(folio.auctionLength.eq(MAX_AUCTION_LENGTH), true);

    const ownerActorPDA = getActorPDA(folioOwnerKeypair.publicKey, folioPDA);

    const ownerActor = await programFolio.account.actor.fetch(ownerActorPDA);

    assert.notEqual(ownerActor.bump, 0);
    assert.deepEqual(ownerActor.authority, folioOwnerKeypair.publicKey);

    // Initialize the test helper after the folio creation, since need the folio token mint
    folioTestHelper = new TestHelper(
      connection,
      payerKeypair,
      programFolio,
      folioPDA,
      folioTokenMint.publicKey,
      userKeypair.publicKey,
      tokenMints.map((tokenMint) => ({
        mint: tokenMint.mint.publicKey,
        decimals: tokenMint.decimals,
      }))
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
      currentFeeDistributionIndex,
      null,
      null,
      [],
      [],
      null
    );

    const folioAfter = await programFolio.account.folio.fetch(folioPDA);
    const feeRecipientsAfter = await programFolio.account.feeRecipients.fetch(
      getTVLFeeRecipientsPDA(folioPDA)
    );

    assert.equal(folioAfter.tvlFee.eq(folioBefore.tvlFee), false);
    assert.equal(null, feeRecipientsBefore);
    assert.notEqual(null, feeRecipientsAfter);

    // Resetting
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
      [],
      [],
      null
    );
  });

  it("should update fee recipients of folio", async () => {
    const folioBefore = await programFolio.account.folio.fetch(folioPDA);
    const feeRecipientsBefore = await programFolio.account.feeRecipients.fetch(
      getTVLFeeRecipientsPDA(folioPDA)
    );

    await updateFolio(
      connection,
      folioOwnerKeypair,
      folioPDA,
      folioTokenMint.publicKey,
      feeRecipient,
      null,
      getAndIncreaseCurrentFeeDistributionIndex(),
      null,
      null,
      newFeeRecipient,
      [],
      null
    );

    const folioAfter = await programFolio.account.folio.fetch(folioPDA);
    const feeRecipientsAfter = await programFolio.account.feeRecipients.fetch(
      getTVLFeeRecipientsPDA(folioPDA)
    );

    assert.equal(folioAfter.tvlFee.eq(folioBefore.tvlFee), true);

    assert.deepEqual(
      feeRecipientsAfter.feeRecipients[0].recipient,
      newFeeRecipient[0].recipient
    );
    assert.deepEqual(
      feeRecipientsAfter.feeRecipients[1].recipient,
      newFeeRecipient[1].recipient
    );
    assert.deepEqual(
      feeRecipientsAfter.feeRecipients.slice(2),
      feeRecipientsBefore.feeRecipients.slice(2)
    );
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

  it("should add auction launcher", async () => {
    await addOrUpdateActor(
      connection,
      folioOwnerKeypair,
      folioPDA,
      auctionLauncherKeypair.publicKey,
      {
        auctionLauncher: {},
      }
    );

    const actor = await programFolio.account.actor.fetch(
      getActorPDA(auctionLauncherKeypair.publicKey, folioPDA)
    );

    assert.deepEqual(actor.roles, 4); //  binary 100 = 4 for auction launcher
    assert.deepEqual(actor.authority, auctionLauncherKeypair.publicKey);
    assert.deepEqual(actor.folio, folioPDA);
    assert.notEqual(actor.bump, 0);
  });

  it("should update rebalance manager to also have auction launcher role", async () => {
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

  it("should remove auction launcher", async () => {
    await removeActor(
      connection,
      folioOwnerKeypair,
      folioPDA,
      auctionLauncherKeypair.publicKey,
      {
        auctionLauncher: {},
      },
      true
    );

    await wait(2);

    const actor = await programFolio.account.actor.fetchNullable(
      getActorPDA(auctionLauncherKeypair.publicKey, folioPDA)
    );

    // Null since we closed it
    assert.equal(actor, null);

    // Just to test re-init attack, we'll re-init the actor and see the fields
    await airdrop(
      connection,
      getActorPDA(auctionLauncherKeypair.publicKey, folioPDA),
      1000
    );

    const actorPostReinit = await programFolio.account.actor.fetchNullable(
      getActorPDA(auctionLauncherKeypair.publicKey, folioPDA)
    );

    assert.equal(actorPostReinit, null);
  });

  it("should add a token to the folio", async () => {
    const beforeSnapshot = await folioTestHelper.getBalanceSnapshot(
      false,
      false,
      true
    );

    await addToBasket(
      connection,
      folioOwnerKeypair,
      folioPDA,
      [
        {
          mint: tokenMints[0].mint.publicKey,
          amount: new BN(100 * 10 ** tokenMints[0].decimals),
        },
      ],
      null,
      folioTokenMint.publicKey
    );

    const afterSnapshot = await folioTestHelper.getBalanceSnapshot(
      false,
      false,
      true
    );

    folioTestHelper.assertBalanceSnapshot(
      beforeSnapshot,
      afterSnapshot,
      [],
      [[0, 100]],
      [],
      [0],
      true
    );
  });

  it("should add another 4 tokens to the folio", async () => {
    const tokenAmountsToAdd = tokenMints.slice(1).map((token) => ({
      mint: token.mint.publicKey,
      amount: new BN(100 * 10 ** token.decimals),
    }));

    folioTestHelper.setUserPubkey(folioOwnerKeypair.publicKey);

    const beforeSnapshot = await folioTestHelper.getBalanceSnapshot(
      false,
      true,
      true
    );

    await addToBasket(
      connection,
      folioOwnerKeypair,
      folioPDA,
      tokenAmountsToAdd,
      new BN(10 * DEFAULT_DECIMALS_MUL), //10 shares, mint decimals for folio token is 9
      folioTokenMint.publicKey
    );

    const afterSnapshot = await folioTestHelper.getBalanceSnapshot(
      false,
      true,
      true
    );

    const folioAfter = await programFolio.account.folio.fetch(folioPDA);

    assert.equal(folioAfter.status, 1);

    folioTestHelper.assertBalanceSnapshot(
      beforeSnapshot,
      afterSnapshot,
      [],
      [[], [-100, 100], [-100, 100], [-100, 100], [-100, 100]],
      [0, 10],
      [1, 2, 3, 4],
      true
    );
  });

  it("should allow user to init mint folio tokens", async () => {
    folioTestHelper.setUserPubkey(userKeypair.publicKey);

    await addToPendingBasket(connection, userKeypair, folioPDA, [
      {
        mint: tokenMints[0].mint.publicKey,
        amount: new BN(100 * 10 ** tokenMints[0].decimals),
      },
    ]);

    const userPendingBasketPDA = getUserPendingBasketPDA(
      folioPDA,
      userKeypair.publicKey
    );

    const userPendingBasket =
      await programFolio.account.userPendingBasket.fetch(userPendingBasketPDA);

    assert.equal(
      userPendingBasket.basket.tokenAmounts[0].amountForMinting.toNumber(),
      100 * 10 ** tokenMints[0].decimals
    );
  });

  it("should allow user to add to mint folio tokens", async () => {
    folioTestHelper.setUserPubkey(userKeypair.publicKey);
    const beforeSnapshot = await folioTestHelper.getBalanceSnapshot(
      true,
      false,
      false
    );

    await addToPendingBasket(connection, userKeypair, folioPDA, [
      {
        mint: tokenMints[1].mint.publicKey,
        amount: new BN(100 * 10 ** tokenMints[1].decimals),
      },
      {
        mint: tokenMints[2].mint.publicKey,
        amount: new BN(200 * 10 ** tokenMints[2].decimals),
      },
      {
        mint: tokenMints[3].mint.publicKey,
        amount: new BN(300 * 10 ** tokenMints[3].decimals),
      },
    ]);

    const afterSnapshot = await folioTestHelper.getBalanceSnapshot(
      true,
      false,
      false
    );

    folioTestHelper.assertBalanceSnapshot(
      beforeSnapshot,
      afterSnapshot,
      [
        [0, 0],
        [
          100 * 10 ** tokenMints[1].decimals,
          100 * 10 ** tokenMints[1].decimals,
        ],
        [
          200 * 10 ** tokenMints[2].decimals,
          200 * 10 ** tokenMints[2].decimals,
        ],
        [
          300 * 10 ** tokenMints[3].decimals,
          300 * 10 ** tokenMints[3].decimals,
        ],
      ],
      [],
      [],
      [0, 1, 2, 3],
      false
    );
  });

  it("should not allow user to mint folio token, because missing 5th token", async () => {
    const beforeSnapshot = await folioTestHelper.getBalanceSnapshot(
      true,
      true,
      false
    );

    await assertThrows(
      () =>
        mintFolioToken(
          connection,
          userKeypair,
          folioPDA,
          folioTokenMint.publicKey,
          new BN(1)
        ),
      "MintMismatch",
      "Should fail when mint mismatch"
    );

    const afterSnapshot = await folioTestHelper.getBalanceSnapshot(
      true,
      true,
      false
    );

    folioTestHelper.assertBalanceSnapshot(
      beforeSnapshot,
      afterSnapshot,
      // Shouldn't have changed
      [
        [0, 0],
        [0, 0],
        [0, 0],
        [0, 0],
      ],
      [],
      [0, 0],
      [0, 1, 2, 3],
      false
    );
  });

  it("should allow user to remove pending token from token #4", async () => {
    // Only remove 100 so we can still mint
    const beforeSnapshot = await folioTestHelper.getBalanceSnapshot(
      true,
      false,
      false
    );

    await removeFromPendingBasket(connection, userKeypair, folioPDA, [
      {
        mint: tokenMints[3].mint.publicKey,
        amount: new BN(100 * 10 ** tokenMints[3].decimals),
      },
    ]);

    const afterSnapshot = await folioTestHelper.getBalanceSnapshot(
      true,
      false,
      false
    );

    folioTestHelper.assertBalanceSnapshot(
      beforeSnapshot,
      afterSnapshot,
      [
        [],
        [],
        [],
        [
          -100 * 10 ** tokenMints[3].decimals,
          -100 * 10 ** tokenMints[3].decimals,
        ],
      ],
      [],
      [],
      [3],
      false
    );
  });

  it("should allow user to mint folio token (after adding 5th token)", async () => {
    await addToPendingBasket(connection, userKeypair, folioPDA, [
      {
        mint: tokenMints[4].mint.publicKey,
        amount: new BN(100 * 10 ** tokenMints[4].decimals),
      },
    ]);

    const beforeSnapshot = await folioTestHelper.getBalanceSnapshot(
      true,
      true,
      false
    );

    const sharesToMint = new BN(3).mul(new BN(DEFAULT_DECIMALS_MUL));

    await mintFolioToken(
      connection,
      userKeypair,
      folioPDA,
      folioTokenMint.publicKey,
      sharesToMint
    );

    const folioAfter = await programFolio.account.folio.fetch(folioPDA);

    const afterSnapshot = await folioTestHelper.getBalanceSnapshot(
      true,
      true,
      false
    );

    assert.equal(
      folioAfter.daoPendingFeeShares.gte(new BN("75000000000000000")),
      true
    );
    assert.equal(
      folioAfter.feeRecipientsPendingFeeShares.gte(new BN("75000000000000000")),
      true
    );

    // Take 30% (3 tokens and 10 is the supply)
    folioTestHelper.assertBalanceSnapshot(
      beforeSnapshot,
      afterSnapshot,
      Array.from({ length: 5 }).map((_, i) => [
        -29.999999999 * 10 ** tokenMints[i].decimals,
        -29.999999999 * 10 ** tokenMints[i].decimals,
      ]),
      [],
      // Receives a bit less than 3 tokens because of the fees
      [0, 2.85],
      [0, 1, 2, 3, 4],
      true,
      "amountForMinting",
      true,
      [130000000000, 130000000000, 13000000, 130000000000, 130000000000]
    );
  });

  it("should allow user to burn folio token (burn 2 tokens)", async () => {
    const beforeSnapshot = await folioTestHelper.getBalanceSnapshot(
      true,
      true,
      false
    );

    await burnFolioToken(
      connection,
      userKeypair,
      folioPDA,
      folioTokenMint.publicKey,
      new BN(2).mul(new BN(DEFAULT_DECIMALS_MUL))
    );

    const afterSnapshot = await folioTestHelper.getBalanceSnapshot(
      true,
      true,
      false
    );

    folioTestHelper.assertBalanceSnapshot(
      beforeSnapshot,
      afterSnapshot,
      Array.from({ length: 5 }).map((_, i) => [
        20 * 10 ** tokenMints[i].decimals,
        20 * 10 ** tokenMints[i].decimals,
      ]),
      [],
      [0, -2],
      [0, 1, 2, 3, 4],
      true,
      "amountForRedeeming",
      true
    );
  });

  it("should allow user to redeem from burn folio token", async () => {
    const beforeSnapshot = await folioTestHelper.getBalanceSnapshot(
      true,
      false,
      true
    );

    await redeemFromPendingBasket(
      connection,
      userKeypair,
      folioPDA,
      tokenMints.map((token) => ({
        mint: token.mint.publicKey,
        amount: new BN(1 * 10 ** token.decimals),
      }))
    );

    const afterSnapshot = await folioTestHelper.getBalanceSnapshot(
      true,
      false,
      true
    );

    folioTestHelper.assertBalanceSnapshot(
      beforeSnapshot,
      afterSnapshot,
      Array.from({ length: 5 }).map((_, i) => [
        -1 * 10 ** tokenMints[i].decimals,
        -1 * 10 ** tokenMints[i].decimals,
      ]),
      [
        [1, -1],
        [1, -1],
        [1, -1],
        [1, -1],
        [1, -1],
      ],
      [],
      [0, 1, 2, 3, 4],
      false,
      "amountForRedeeming"
    );
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
      daoFeeConfig.feeRecipient
    );

    const balanceDaoFeeRecipientBefore = await getTokenBalance(
      connection,
      daoFeeRecipientATA
    );

    await distributeFees(
      connection,
      userKeypair,
      folioPDA,
      folioTokenMint.publicKey,
      daoFeeRecipientATA,
      new BN(1)
    );

    const feeDistribution = await programFolio.account.feeDistribution.fetch(
      getFeeDistributionPDA(folioPDA, new BN(1))
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
      balanceDaoFeeRecipientAfter > balanceDaoFeeRecipientBefore,
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
    assert.equal(feeDistribution.index.toNumber(), 1);
    assert.equal(feeDistribution.amountToDistribute.gt(new BN(0)), true);
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
      newFeeRecipient[0].recipient
    );
    const newRecipient2ATA = await getOrCreateAtaAddress(
      connection,
      folioTokenMint.publicKey,
      userKeypair,
      newFeeRecipient[1].recipient
    );

    const feeDistributionBefore =
      await programFolio.account.feeDistribution.fetch(
        getFeeDistributionPDA(folioPDA, new BN(1))
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
      new BN(1),
      [new BN(0), new BN(1)],
      [newRecipient1ATA, newRecipient2ATA]
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
        getFeeDistributionPDA(folioPDA, new BN(1))
      );

    // Balances should be updated for both fee recipients
    assert.equal(balanceNewRecipient1After > balanceNewRecipient1Before, true);
    assert.equal(balanceNewRecipient2After > balanceNewRecipient2Before, true);

    // Fee distribution should be closed
    assert.notEqual(feeDistributionBefore, null);
    assert.equal(feeDistributionAfter, null);
  });

  it("should allow user to start rebalance", async () => {
    const sellMint = tokenMints[1].mint.publicKey;

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
            high: new BN(2),
          },
          limits: {
            low: new BN(1),
            spot: new BN(2000).mul(D18),
            high: new BN(2000).mul(D18),
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
      [buyMint.publicKey, sellMint]
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
      buyMint.publicKey.toBase58()
    );
    assert.equal(
      rebalance.details.tokens[1].mint.toBase58(),
      sellMint.toBase58()
    );

    assert.equal(rebalance.details.tokens[0].prices.low.eq(new BN(1)), true);
    assert.equal(rebalance.details.tokens[0].prices.high.eq(new BN(2)), true);
    assert.equal(rebalance.details.tokens[1].prices.low.eq(new BN(1)), true);
    assert.equal(rebalance.details.tokens[1].prices.high.eq(new BN(2)), true);
    assert.equal(
      rebalance.details.tokens[2].mint.toBase58(),
      PublicKey.default.toBase58()
    );
  });

  it("should allow user to open auction", async () => {
    const sellMint = tokenMints[1].mint.publicKey;

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
      new BN(2),
      new BN(2000),
      new BN(2).mul(D18),
      new BN(1).mul(D18),
      sellMint,
      buyMint.publicKey
    );

    const auction = await programFolio.account.auction.fetch(auctionPDA);

    assert.equal(auction.sellLimit.eq(new BN(2)), true);
    assert.equal(auction.buyLimit.eq(new BN(2000)), true);
    assert.equal(auction.prices.start.eq(new BN(2).mul(D18)), true);
    assert.equal(auction.prices.end.eq(new BN(1).mul(D18)), true);
    TestHelper.assertTime(auction.start, new BN(currentTimeOnSolana));
    TestHelper.assertTime(
      auction.end,
      new BN(currentTimeOnSolana + folio.auctionLength.toNumber())
    );
    assert.equal(auction.sellMint.toBase58(), sellMint.toBase58());
    assert.equal(auction.buyMint.toBase58(), buyMint.publicKey.toBase58());
  });

  it("should allow user to bid without callback", async () => {
    const rebalance = await programFolio.account.rebalance.fetch(
      getRebalancePDA(folioPDA)
    );
    const auctionPDA = getAuctionPDA(folioPDA, rebalance.nonce, new BN(1));
    const auctionFetched = await programFolio.account.auction.fetch(auctionPDA);

    const buyMint = await getMint(connection, auctionFetched.buyMint);
    const sellMint = await getMint(connection, auctionFetched.sellMint);

    folioTestHelper.setTokenMints([
      { mint: buyMint.address, decimals: buyMint.decimals },
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
      new BN(1000),
      new BN(30000)
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
        [-1000 / DEFAULT_DECIMALS_MUL, 1000 / DEFAULT_DECIMALS_MUL],
        [1000 / DEFAULT_DECIMALS_MUL, -1000 / DEFAULT_DECIMALS_MUL],
      ],
      [],
      [0, 1],
      true,
      "amountForMinting",
      true
    );
  });

  it("should allow auction actor to kill auction", async () => {
    const rebalance = await programFolio.account.rebalance.fetch(
      getRebalancePDA(folioPDA)
    );
    const auctionPDA = getAuctionPDA(folioPDA, rebalance.nonce, new BN(1));
    const auction = await programFolio.account.auction.fetch(auctionPDA);

    const auctionEndPda = getAuctionEndsPDA(
      folioPDA,
      rebalance.nonce,
      auction.sellMint,
      auction.buyMint
    );

    const auctionEnds = await programFolio.account.auctionEnds.fetch(
      auctionEndPda
    );

    const auctionEndBefore = auctionEnds.endTime;

    const currentTimeOnSolana = await getSolanaCurrentTime(connection);

    await killAuction(
      connection,
      rebalanceManagerKeypair,
      folioPDA,
      auctionPDA,
      rebalance.nonce,
      auction.sellMint,
      auction.buyMint
    );

    const auctionAfter = await programFolio.account.auction.fetch(auctionPDA);

    assert.equal(auctionAfter.end.toNumber() <= currentTimeOnSolana, true);
    const auctionEndAfter = await programFolio.account.auctionEnds.fetch(
      auctionEndPda
    );

    assert.notEqual(auctionEndAfter.endTime, auctionEndBefore);
    assert.equal(
      auctionEndAfter.endTime.toNumber() <= currentTimeOnSolana,
      true
    );
  });

  // Works, but for CI seemed to give issue, so skipping (tested in Bankrun anyways)
  it.skip("should allow user to bid with callback", async () => {
    const rebalance = await programFolio.account.rebalance.fetch(
      getRebalancePDA(folioPDA)
    );
    const auctionPDA = getAuctionPDA(folioPDA, rebalance.nonce, new BN(1));
    const auctionFetched = await programFolio.account.auction.fetch(auctionPDA);

    const buyMint = await getMint(connection, auctionFetched.buyMint);
    const sellMint = await getMint(connection, auctionFetched.sellMint);

    folioTestHelper.setTokenMints([
      { mint: buyMint.address, decimals: buyMint.decimals },
      { mint: sellMint.address, decimals: sellMint.decimals },
    ]);
    const balancesBefore = await folioTestHelper.getBalanceSnapshot(
      false,
      false,
      true
    );

    // Simple callback instruction to test out the flow
    const transferBuyTokenIx = createTransferInstruction(
      await getOrCreateAtaAddress(
        connection,
        buyMint.address,
        userKeypair,
        userKeypair.publicKey
      ),
      await getOrCreateAtaAddress(
        connection,
        buyMint.address,
        userKeypair,
        folioPDA
      ),
      userKeypair.publicKey,
      500
    );

    await bid(
      connection,
      userKeypair,
      folioPDA,
      folioTokenMint.publicKey,
      auctionPDA,
      new BN(500),
      new BN(500),
      true,
      transferBuyTokenIx.data,
      [
        {
          isWritable: false,
          isSigner: false,
          pubkey: TOKEN_PROGRAM_ID,
        },
        ...transferBuyTokenIx.keys,
      ]
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
        [-500 / DEFAULT_DECIMALS_MUL, 500 / DEFAULT_DECIMALS_MUL],
        [500 / DEFAULT_DECIMALS_MUL, -500 / DEFAULT_DECIMALS_MUL],
      ],
      [],
      [0, 1],
      true,
      "amountForMinting",
      true
    );
  });
});
