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
  accrueRewards,
  addOrUpdateActor,
  addRewardToken,
  addToBasket,
  addToPendingBasket,
  approveAuction,
  bid,
  burnFolioToken,
  claimRewards,
  crankFeeDistribution,
  distributeFees,
  initFolio,
  initOrSetRewardRatio,
  killAuction,
  mintFolioToken,
  openAuction,
  pokeFolio,
  redeemFromPendingBasket,
  removeActor,
  removeFromPendingBasket,
  removeRewardToken,
  resizeFolio,
  updateFolio,
} from "../utils/folio-helper";
import * as assert from "assert";

import {
  getActorPDA,
  getDAOFeeConfigPDA,
  getFeeDistributionPDA,
  getFolioBasketPDA,
  getTVLFeeRecipientsPDA,
  getFolioRewardTokensPDA,
  getRewardInfoPDA,
  getAuctionPDA,
  getUserPendingBasketPDA,
  getUserRewardInfoPDA,
  getUserTokenRecordRealmsPDA,
} from "../utils/pda-helper";
import {
  DEFAULT_DECIMALS_MUL,
  MAX_AUCTION_LENGTH,
  MAX_TVL_FEE,
  MAX_AUCTION_DELAY,
  MAX_TTL,
  MAX_MINT_FEE,
  MAX_FEE_FLOOR,
  EXPECTED_TVL_FEE_WHEN_MAX,
  DEFAULT_DECIMALS_MUL_D18,
} from "../utils/constants";
import { TestHelper } from "../utils/test-helper";
import { createGovernanceAccounts } from "../utils/data-helper";
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

describe("Folio Tests", () => {
  let connection: Connection;
  let programFolio: Program<Folio>;
  let programFolioAdmin: Program<FolioAdmin>;
  let keys: any;

  let payerKeypair: Keypair;
  let adminKeypair: Keypair;
  let userKeypair: Keypair;

  let auctionLauncherKeypair: Keypair;
  let auctionApproverKeypair: Keypair;

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
    { mint: Keypair.generate(), decimals: 9 },
    { mint: Keypair.generate(), decimals: 9 },
    { mint: Keypair.generate(), decimals: 5 },
    { mint: Keypair.generate(), decimals: 9 },
    { mint: Keypair.generate(), decimals: 9 },
  ];

  let buyMint: Keypair;

  const rewardTokenMints = [
    { mint: Keypair.generate(), decimals: 9 },
    { mint: Keypair.generate(), decimals: 9 },
    { mint: Keypair.generate(), decimals: 9 },
  ];

  const feeRecipient: PublicKey = Keypair.generate().publicKey;
  const feeNumerator: BN = new BN("500000000000000000"); //50% in D18

  let currentFeeDistributionIndex: BN = new BN(1);

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
    auctionApproverKeypair = Keypair.generate();
    auctionLauncherKeypair = Keypair.generate();

    // Inject fake accounts in Amman for governance
    const userTokenRecordPda = getUserTokenRecordRealmsPDA(
      folioOwnerKeypair.publicKey,
      folioTokenMint.publicKey,
      userKeypair.publicKey
    );

    await createGovernanceAccounts(userTokenRecordPda, 1000);

    await wait(10);

    await airdrop(connection, payerKeypair.publicKey, 1000);
    await airdrop(connection, adminKeypair.publicKey, 1000);
    await airdrop(connection, folioOwnerKeypair.publicKey, 1000);
    await airdrop(connection, userKeypair.publicKey, 1000);
    await airdrop(connection, auctionApproverKeypair.publicKey, 1000);
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
    await initToken(connection, adminKeypair, buyMint, 9);
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

    for (const rewardTokenMint of rewardTokenMints) {
      await initToken(connection, adminKeypair, rewardTokenMint.mint, 9);
      await mintToken(
        connection,
        adminKeypair,
        rewardTokenMint.mint.publicKey,
        1_000,
        adminKeypair.publicKey
      );
    }

    // Set dao fee recipient
    await setDaoFeeConfig(
      connection,
      adminKeypair,
      feeRecipient,
      feeNumerator,
      MAX_FEE_FLOOR
    );
  });

  after(async () => {
    // Seems like anchor is hanging sometimes because of the "mock" governance accounts that update Amman, so we
    // force exit after 1 second

    // Clear all program references
    programFolio = null;
    programFolioAdmin = null;

    // Clear connection
    if (connection) {
      // @ts-ignore - force clear internal properties
      connection._rpcWebSocket.close();
      connection = null;
    }

    // Force exit after 1 second
    setTimeout(() => {
      process.exit(0);
    }, 5000);
  });

  it("should initialize a folio", async () => {
    folioPDA = await initFolio(
      connection,
      folioOwnerKeypair,
      folioTokenMint,
      MAX_TVL_FEE,
      MAX_MINT_FEE,
      MAX_AUCTION_DELAY,
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
    assert.equal(folio.auctionDelay.eq(MAX_AUCTION_DELAY), true);
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

  it("should resize folio", async () => {
    const folioSizeBefore = (await connection.getAccountInfo(folioPDA))?.data
      .length;

    await resizeFolio(
      connection,
      folioOwnerKeypair,
      folioPDA,
      new BN(folioSizeBefore + 100)
    );

    await wait(2);

    const folioSizeAfter = (await connection.getAccountInfo(folioPDA))?.data
      .length;

    assert.equal(folioSizeAfter, folioSizeBefore + 100);
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
      folioBefore.tvlFee.sub(new BN(1)),
      getAndIncreaseCurrentFeeDistributionIndex(),
      null,
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
      // This will put the tvl fee lower, as we're calling set_tvl_fee which does calculations
      folioBefore.tvlFee,
      getAndIncreaseCurrentFeeDistributionIndex(),
      null,
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
      null,
      getAndIncreaseCurrentFeeDistributionIndex(),
      null,
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

  it("should add auction approver", async () => {
    await addOrUpdateActor(
      connection,
      folioOwnerKeypair,
      folioPDA,
      auctionApproverKeypair.publicKey,
      {
        auctionApprover: {},
      }
    );

    const actor = await programFolio.account.actor.fetch(
      getActorPDA(auctionApproverKeypair.publicKey, folioPDA)
    );

    assert.deepEqual(actor.roles, 2); //  binary 10 = 2 for auction approver
    assert.deepEqual(actor.authority, auctionApproverKeypair.publicKey);
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

  it("should update auction approver to also have auction launcher role", async () => {
    await addOrUpdateActor(
      connection,
      folioOwnerKeypair,
      folioPDA,
      auctionApproverKeypair.publicKey,
      {
        auctionLauncher: {},
      }
    );

    const actor = await programFolio.account.actor.fetch(
      getActorPDA(auctionApproverKeypair.publicKey, folioPDA)
    );

    assert.deepEqual(actor.roles, 6); //  binary 110 = 6 for auction approver and auction launcher
    assert.deepEqual(actor.authority, auctionApproverKeypair.publicKey);
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
      [0]
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
      [1, 2, 3, 4]
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

    const folioBasketPDA = getFolioBasketPDA(folioPDA);

    const userPendingBasket =
      await programFolio.account.userPendingBasket.fetch(userPendingBasketPDA);

    const folioBasket = await programFolio.account.folioBasket.fetch(
      folioBasketPDA
    );

    assert.equal(
      userPendingBasket.tokenAmounts[0].amountForMinting.toNumber(),
      100 * 10 ** tokenMints[0].decimals
    );

    assert.equal(
      folioBasket.tokenAmounts[0].amountForMinting.toNumber(),
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
      [0, 1, 2, 3]
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
          tokenMints.map((token) => ({
            mint: token.mint.publicKey,
            amount: new BN(0),
          })),
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
      [0, 1, 2, 3]
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
      [3]
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

    await mintFolioToken(
      connection,
      userKeypair,
      folioPDA,
      folioTokenMint.publicKey,
      tokenMints.map((token) => ({
        mint: token.mint.publicKey,
        amount: new BN(0),
      })),
      new BN(3).mul(new BN(DEFAULT_DECIMALS_MUL))
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
        -29.999999976 * 10 ** tokenMints[i].decimals,
        -29.999999976 * 10 ** tokenMints[i].decimals,
      ]),
      [],
      // Receives a bit less than 3 tokens because of the fees
      [0, 2.85],
      [0, 1, 2, 3, 4],
      "amountForMinting",
      true
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
      new BN(2).mul(new BN(DEFAULT_DECIMALS_MUL)),
      tokenMints.map((token) => ({
        mint: token.mint.publicKey,
        amount: new BN(0),
      }))
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
        19.99999998 * 10 ** tokenMints[i].decimals,
        19.99999998 * 10 ** tokenMints[i].decimals,
      ]),
      [],
      [0, -2],
      [0, 1, 2, 3, 4],
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
      "amountForRedeeming"
    );
  });

  it("should allow user to poke folio and update pending fees", async () => {
    const folioBefore = await programFolio.account.folio.fetch(folioPDA);

    await pokeFolio(
      connection,
      userKeypair,
      folioPDA,
      folioTokenMint.publicKey
    );

    const folioAfter = await programFolio.account.folio.fetch(folioPDA);

    const daoFeeDiff = folioAfter.daoPendingFeeShares.sub(
      folioBefore.daoPendingFeeShares
    );
    const recipientFeeDiff = folioAfter.feeRecipientsPendingFeeShares.sub(
      folioBefore.feeRecipientsPendingFeeShares
    );

    assert.equal(daoFeeDiff.gt(new BN(500000000)), true);
    // 0 because been taking by dao fee numerator
    assert.equal(recipientFeeDiff.eq(new BN(0)), true);
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

  it("should allow user to approve auction", async () => {
    const sellMint = tokenMints[1].mint.publicKey;

    const currentTimeOnSolana = await getSolanaCurrentTime(connection);
    const folio = await programFolio.account.folio.fetch(folioPDA);

    const ttl = MAX_TTL;

    await approveAuction(
      connection,
      auctionApproverKeypair,
      folioPDA,
      buyMint.publicKey,
      sellMint,
      new BN(1),
      { spot: new BN(1), low: new BN(0), high: new BN(2) },
      { spot: new BN(1), low: new BN(0), high: new BN(2) },
      new BN(2),
      new BN(1),
      ttl
    );

    const auction = await programFolio.account.auction.fetch(
      getAuctionPDA(folioPDA, new BN(1))
    );

    assert.equal(auction.id.toNumber(), 1);
    assert.equal(auction.folio.toBase58(), folioPDA.toBase58());
    assert.equal(auction.sell.toBase58(), sellMint.toBase58());
    assert.equal(auction.buy.toBase58(), buyMint.publicKey.toBase58());
    assert.equal(auction.sellLimit.spot.eq(new BN(1)), true);
    assert.equal(auction.sellLimit.low.eq(new BN(0)), true);
    assert.equal(auction.sellLimit.high.eq(new BN(2)), true);
    assert.equal(auction.buyLimit.spot.eq(new BN(1)), true);
    assert.equal(auction.buyLimit.low.eq(new BN(0)), true);
    assert.equal(auction.buyLimit.high.eq(new BN(2)), true);
    assert.equal(auction.prices.start.eq(new BN(2)), true);
    assert.equal(auction.prices.end.eq(new BN(1)), true);
    assert.equal(
      auction.availableAt.toNumber() >=
        currentTimeOnSolana + folio.auctionDelay.toNumber(),
      true
    );
    assert.equal(
      auction.launchTimeout.toNumber() >= currentTimeOnSolana + ttl.toNumber(),
      true
    );
    assert.equal(auction.start.eq(new BN(0)), true);
    assert.equal(auction.end.eq(new BN(0)), true);
    assert.equal(auction.k.eq(new BN(0)), true);
  });

  it("should allow user to open auction", async () => {
    const auctionPDA = getAuctionPDA(folioPDA, new BN(1));
    const folio = await programFolio.account.folio.fetch(folioPDA);

    const currentTimeOnSolana = await getSolanaCurrentTime(connection);

    await openAuction(
      connection,
      // Auction launcher is removed in the test above, but approver gets the 2 roles
      auctionApproverKeypair,
      folioPDA,
      auctionPDA,
      new BN(2),
      new BN(2),
      new BN(2),
      new BN(1)
    );

    const auction = await programFolio.account.auction.fetch(auctionPDA);

    // Update limits and prices
    assert.equal(auction.sellLimit.spot.eq(new BN(2)), true);
    assert.equal(auction.buyLimit.spot.eq(new BN(2)), true);
    assert.equal(auction.prices.start.eq(new BN(2)), true);
    assert.equal(auction.prices.end.eq(new BN(1)), true);

    // Assert auction is opened
    assert.equal(auction.start.toNumber() >= currentTimeOnSolana, true);
    assert.equal(
      auction.end.toNumber() >=
        currentTimeOnSolana + folio.auctionLength.toNumber(),
      true
    );

    assert.equal(auction.k.eq(new BN(1146076687433)), true);
  });

  it.skip("should allow auction actor to kill auction", async () => {
    const auctionPDA = getAuctionPDA(folioPDA, new BN(1));
    const auction = await programFolio.account.auction.fetch(auctionPDA);

    const folioBefore = await programFolio.account.folio.fetch(folioPDA);

    const auctionEndBuyBefore = folioBefore.buyEnds.find(
      (auctionEnd) => auctionEnd.mint.toBase58() === auction.buy.toBase58()
    );
    const auctionEndSellBefore = folioBefore.sellEnds.find(
      (auctionEnd) => auctionEnd.mint.toBase58() === auction.sell.toBase58()
    );

    const currentTimeOnSolana = await getSolanaCurrentTime(connection);

    await killAuction(connection, auctionApproverKeypair, folioPDA, auctionPDA);

    const folioAfter = await programFolio.account.folio.fetch(folioPDA);

    assert.equal(
      (await programFolio.account.auction.fetch(auctionPDA)).end.toNumber(),
      1
    );

    const auctionEndBuyAfter = folioAfter.buyEnds.find(
      (auctionEnd) => auctionEnd.mint.toBase58() === auction.buy.toBase58()
    );
    const auctionEndSellAfter = folioAfter.sellEnds.find(
      (auctionEnd) => auctionEnd.mint.toBase58() === auction.sell.toBase58()
    );

    assert.notEqual(
      auctionEndBuyAfter!.endTime.toNumber(),
      auctionEndBuyBefore!.endTime.toNumber()
    );
    assert.notEqual(
      auctionEndSellAfter!.endTime.toNumber(),
      auctionEndSellBefore!.endTime.toNumber()
    );

    assert.equal(
      auctionEndBuyAfter!.endTime.toNumber() >= currentTimeOnSolana,
      true
    );
    assert.equal(
      auctionEndSellAfter!.endTime.toNumber() >= currentTimeOnSolana,
      true
    );
  });

  it("should allow user to bid without callback", async () => {
    const auctionPDA = getAuctionPDA(folioPDA, new BN(1));
    const auctionFetched = await programFolio.account.auction.fetch(auctionPDA);

    const buyMint = await getMint(connection, auctionFetched.buy);
    const sellMint = await getMint(connection, auctionFetched.sell);

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
      new BN(2000)
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
      "amountForMinting",
      true
    );
  });

  it("should allow user to bid with callback", async () => {
    const auctionPDA = getAuctionPDA(folioPDA, new BN(1));
    const auctionFetched = await programFolio.account.auction.fetch(auctionPDA);

    const buyMint = await getMint(connection, auctionFetched.buy);
    const sellMint = await getMint(connection, auctionFetched.sell);

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
      "amountForMinting",
      true
    );
  });

  /*
   Skipping because it's tedious to create a realm and go through the spl governance process
   (tested via bankrun instead)
   */
  it.skip("should allow user to add reward token", async () => {
    await addRewardToken(
      connection,
      new Keypair(), // TODO
      folioOwnerKeypair,
      folioPDA,
      rewardTokenMints[0].mint.publicKey,
      new BN(86400)
    );

    const folioRewardTokens =
      await programFolio.account.folioRewardTokens.fetch(
        getFolioRewardTokensPDA(folioPDA)
      );

    assert.equal(
      folioRewardTokens.rewardTokens[0].toBase58(),
      rewardTokenMints[0].mint.publicKey.toBase58()
    );
    assert.equal(folioRewardTokens.rewardRatio.eq(new BN(8022536812036)), true);
    assert.deepEqual(folioRewardTokens.folio, folioPDA);
    assert.notEqual(folioRewardTokens.bump, 0);
  });

  /*
   Skipping because it's tedious to create a realm and go through the spl governance process
   (tested via bankrun instead)
   */
  it.skip("should allow user to init or set reward ratio", async () => {
    await initOrSetRewardRatio(
      connection,
      new Keypair(), // TODO
      folioOwnerKeypair,
      folioPDA,
      new BN(86400)
    );

    const folioRewardTokensAfter =
      await programFolio.account.folioRewardTokens.fetch(
        getFolioRewardTokensPDA(folioPDA)
      );

    assert.equal(
      folioRewardTokensAfter.rewardRatio.eq(new BN(8022536812036)),
      true
    );
  });

  /*
   Skipping because it's tedious to create a realm and go through the spl governance process
   (tested via bankrun instead)
   */
  it.skip("should allow user to remove reward token", async () => {
    await removeRewardToken(
      connection,
      new Keypair(), // TODO
      folioOwnerKeypair,
      folioPDA,
      rewardTokenMints[0].mint.publicKey
    );

    const folioRewardTokensAfter =
      await programFolio.account.folioRewardTokens.fetch(
        getFolioRewardTokensPDA(folioPDA)
      );

    assert.deepEqual(folioRewardTokensAfter.rewardTokens[0], PublicKey.default);
    assert.deepEqual(
      folioRewardTokensAfter.disallowedToken[0],
      rewardTokenMints[0].mint.publicKey
    );
  });

  /*
   Skipping because it's tedious to create a realm and go through the spl governance process 
   (tested via bankrun instead)
   */
  it.skip("should allow user to accrue rewards, after adding 1 more reward tokens", async () => {
    // Adding the tokens
    await addRewardToken(
      connection,
      new Keypair(), // TODO
      folioOwnerKeypair,
      folioPDA,
      rewardTokenMints[1].mint.publicKey,
      new BN(86400)
    );

    const folioRewardTokenPDA = getFolioRewardTokensPDA(folioPDA);

    const rewardInfoPDA = getRewardInfoPDA(
      folioPDA,
      rewardTokenMints[1].mint.publicKey
    );
    const rewardInfoBefore = await programFolio.account.rewardInfo.fetch(
      rewardInfoPDA
    );

    // Mint some token to the folio (as if received fees)
    // To generate rewards we'll mint a LOT of reward tokens, so that we don't have to wait for them to accrue to claim them
    for (let i = 0; i < 10; i++) {
      await mintToken(
        connection,
        adminKeypair,
        rewardTokenMints[1].mint.publicKey,
        1_000_000_000,
        folioRewardTokenPDA
      );
    }

    // First accrue rewards will be 0 since the balance unaccounted for is 0, so we'll call it twice
    // Calling accrue rewards
    await accrueRewards(
      connection,
      userKeypair,
      Keypair.generate().publicKey, // TODO
      folioOwnerKeypair.publicKey,
      folioPDA,
      [rewardTokenMints[1].mint.publicKey],
      // Here set governance as same as folio token mint, since it doesn't really matter
      folioTokenMint.publicKey,
      userKeypair.publicKey
    );

    const rewardInfoAfterFirstCall =
      await programFolio.account.rewardInfo.fetch(rewardInfoPDA);

    assert.equal(
      rewardInfoAfterFirstCall.balanceLastKnown.gt(
        rewardInfoBefore.balanceLastKnown
      ),
      true
    );

    // To generate a bit of rewards
    await wait(40);

    // Second call will accrue rewards
    await accrueRewards(
      connection,
      userKeypair,
      Keypair.generate().publicKey, // TODO
      folioOwnerKeypair.publicKey,
      folioPDA,
      [rewardTokenMints[1].mint.publicKey],
      // Here set governance as same as folio token mint, since it doesn't really matter
      folioTokenMint.publicKey,
      userKeypair.publicKey
    );

    const rewardInfoAfterSecondCall =
      await programFolio.account.rewardInfo.fetch(rewardInfoPDA);

    const userInfoRewardPDA = getUserRewardInfoPDA(
      folioPDA,
      rewardTokenMints[1].mint.publicKey,
      userKeypair.publicKey
    );

    const userInfoRewardAfter = await programFolio.account.userRewardInfo.fetch(
      userInfoRewardPDA
    );

    assert.equal(
      rewardInfoAfterSecondCall.rewardIndex.gt(rewardInfoBefore.rewardIndex),
      true
    );

    assert.equal(
      rewardInfoAfterSecondCall.balanceAccounted.gt(
        rewardInfoBefore.balanceAccounted
      ),
      true
    );
    assert.equal(
      rewardInfoAfterSecondCall.payoutLastPaid.gt(
        rewardInfoBefore.payoutLastPaid
      ),
      true
    );

    assert.equal(userInfoRewardAfter.folio.toBase58(), folioPDA.toBase58());
    assert.equal(
      userInfoRewardAfter.folioRewardToken.toBase58(),
      rewardTokenMints[1].mint.publicKey.toBase58()
    );
    assert.notEqual(userInfoRewardAfter.bump, 0);
    assert.equal(userInfoRewardAfter.accruedRewards.gte(new BN(0)), true);
    assert.equal(
      userInfoRewardAfter.lastRewardIndex.eq(
        rewardInfoAfterSecondCall.rewardIndex
      ),
      true
    );
  });

  /*
   Skipping because it's tedious to create a realm and go through the spl governance process 
   (tested via bankrun instead)
   */
  it.skip("should allow user to claim rewards", async () => {
    const rewardInfoPDA = getRewardInfoPDA(
      folioPDA,
      rewardTokenMints[1].mint.publicKey
    );
    const userRewardInfoPDA = getUserRewardInfoPDA(
      folioPDA,
      rewardTokenMints[1].mint.publicKey,
      userKeypair.publicKey
    );
    const rewardInfoBefore = await programFolio.account.rewardInfo.fetch(
      rewardInfoPDA
    );

    await claimRewards(
      connection,
      userKeypair,
      folioOwnerKeypair.publicKey,
      folioPDA,
      [rewardTokenMints[1].mint.publicKey]
    );

    const rewardInfoAfter = await programFolio.account.rewardInfo.fetch(
      rewardInfoPDA
    );
    const userRewardInfoAfter = await programFolio.account.userRewardInfo.fetch(
      userRewardInfoPDA
    );

    assert.equal(
      rewardInfoAfter.totalClaimed.gt(rewardInfoBefore.totalClaimed),
      true
    );
    assert.equal(userRewardInfoAfter.accruedRewards.eq(new BN(0)), true);
  });
});
