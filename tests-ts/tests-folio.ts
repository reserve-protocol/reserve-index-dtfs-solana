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
  approveTrade,
  bid,
  burnFolioToken,
  claimRewards,
  crankFeeDistribution,
  distributeFees,
  initFolio,
  initOrSetRewardRatio,
  killTrade,
  mintFolioToken,
  openTrade,
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
  getFolioFeeRecipientsPDA,
  getFolioRewardTokensPDA,
  getRewardInfoPDA,
  getTradePDA,
  getUserPendingBasketPDA,
  getUserRewardInfoPDA,
  getUserTokenRecordRealmsPDA,
} from "../utils/pda-helper";
import {
  DEFAULT_DECIMALS_MUL,
  MAX_AUCTION_LENGTH,
  MAX_FOLIO_FEE,
  MAX_TRADE_DELAY,
  MIN_DAO_MINTING_FEE,
} from "../utils/constants";
import { TestHelper } from "../utils/test-helper";
import { Dtfs } from "../target/types/dtfs";
import { createGovernanceAccounts } from "../utils/data-helper";
import {
  getOrCreateAtaAddress,
  getTokenBalance,
  initToken,
  mintToken,
} from "../utils/token-helper";
import { deserializeU256 } from "../utils/math-helper";
import {
  createTransferInstruction,
  getMint,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { setDaoFeeConfig } from "../utils/dtf-helper";

describe("Folio Tests", () => {
  let connection: Connection;
  let programFolio: Program<Folio>;
  let programDtf: Program<Dtfs>;
  let keys: any;

  let payerKeypair: Keypair;
  let adminKeypair: Keypair;
  let userKeypair: Keypair;

  let tradeLauncherKeypair: Keypair;
  let tradeProposerKeypair: Keypair;

  let folioOwnerKeypair: Keypair;
  let folioTokenMint: Keypair;
  let folioPDA: PublicKey;

  const newFeeRecipient = [
    {
      receiver: Keypair.generate().publicKey,
      portion: new BN(6).mul(new BN(DEFAULT_DECIMALS_MUL)).div(new BN(10)),
    },
    {
      receiver: Keypair.generate().publicKey,
      portion: new BN(4).mul(new BN(DEFAULT_DECIMALS_MUL)).div(new BN(10)),
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
  const feeRecipientNumerator: BN = new BN("500000000000000000"); //50% in D18

  before(async () => {
    ({ connection, programFolio, programDtf, keys } = await getConnectors());

    payerKeypair = Keypair.fromSecretKey(Uint8Array.from(keys.payer));
    adminKeypair = Keypair.fromSecretKey(Uint8Array.from(keys.admin));

    folioTokenMint = Keypair.generate();

    folioOwnerKeypair = Keypair.generate();
    userKeypair = Keypair.generate();
    tradeProposerKeypair = Keypair.generate();
    tradeLauncherKeypair = Keypair.generate();

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
    await airdrop(connection, tradeProposerKeypair.publicKey, 1000);
    await airdrop(connection, tradeLauncherKeypair.publicKey, 1000);

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
      feeRecipientNumerator
    );
  });

  it("should initialize a folio", async () => {
    folioPDA = await initFolio(
      connection,
      folioOwnerKeypair,
      folioTokenMint,
      MAX_FOLIO_FEE,
      MIN_DAO_MINTING_FEE,
      MAX_TRADE_DELAY,
      MAX_AUCTION_LENGTH,
      "Test Folio",
      "TFOL",
      "https://test.com"
    );

    const folio = await programFolio.account.folio.fetch(folioPDA);

    const feeRecipients =
      await programFolio.account.feeRecipients.fetchNullable(
        getFolioFeeRecipientsPDA(folioPDA)
      );

    assert.notEqual(folio.bump, 0);
    assert.equal(folio.folioFee.eq(MAX_FOLIO_FEE), true);
    assert.equal(folio.mintingFee.eq(MIN_DAO_MINTING_FEE), true);
    assert.deepEqual(folio.folioTokenMint, folioTokenMint.publicKey);
    assert.equal(feeRecipients, null);
    assert.equal(folio.tradeDelay.eq(MAX_TRADE_DELAY), true);
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
        getFolioFeeRecipientsPDA(folioPDA)
      );

    await updateFolio(
      connection,
      folioOwnerKeypair,
      folioPDA,
      folioBefore.folioFee.sub(new BN(1)),
      null,
      null,
      null,
      [],
      []
    );

    const folioAfter = await programFolio.account.folio.fetch(folioPDA);
    const feeRecipientsAfter = await programFolio.account.feeRecipients.fetch(
      getFolioFeeRecipientsPDA(folioPDA)
    );

    assert.equal(
      folioAfter.folioFee.eq(folioBefore.folioFee.sub(new BN(1))),
      true
    );
    assert.equal(null, feeRecipientsBefore);
    assert.notEqual(null, feeRecipientsAfter);

    // Resetting
    await updateFolio(
      connection,
      folioOwnerKeypair,
      folioPDA,
      folioBefore.folioFee,
      null,
      null,
      null,
      [],
      []
    );
  });

  it("should update fee recipients of folio", async () => {
    const folioBefore = await programFolio.account.folio.fetch(folioPDA);
    const feeRecipientsBefore = await programFolio.account.feeRecipients.fetch(
      getFolioFeeRecipientsPDA(folioPDA)
    );

    await updateFolio(
      connection,
      folioOwnerKeypair,
      folioPDA,
      null,
      null,
      null,
      null,
      newFeeRecipient,
      []
    );

    const folioAfter = await programFolio.account.folio.fetch(folioPDA);
    const feeRecipientsAfter = await programFolio.account.feeRecipients.fetch(
      getFolioFeeRecipientsPDA(folioPDA)
    );

    assert.equal(folioAfter.folioFee.eq(folioBefore.folioFee), true);

    assert.deepEqual(
      feeRecipientsAfter.feeRecipients[0].receiver,
      newFeeRecipient[0].receiver
    );
    assert.deepEqual(
      feeRecipientsAfter.feeRecipients[1].receiver,
      newFeeRecipient[1].receiver
    );
    assert.deepEqual(
      feeRecipientsAfter.feeRecipients.slice(2),
      feeRecipientsBefore.feeRecipients.slice(2)
    );
  });

  it("should add trade proposer", async () => {
    await addOrUpdateActor(
      connection,
      folioOwnerKeypair,
      folioPDA,
      tradeProposerKeypair.publicKey,
      {
        tradeProposer: {},
      }
    );

    const actor = await programFolio.account.actor.fetch(
      getActorPDA(tradeProposerKeypair.publicKey, folioPDA)
    );

    assert.deepEqual(actor.roles, 2); //  binary 10 = 2 for trade approver
    assert.deepEqual(actor.authority, tradeProposerKeypair.publicKey);
    assert.deepEqual(actor.folio, folioPDA);
    assert.notEqual(actor.bump, 0);
  });

  it("should add trade launcher", async () => {
    await addOrUpdateActor(
      connection,
      folioOwnerKeypair,
      folioPDA,
      tradeLauncherKeypair.publicKey,
      {
        tradeLauncher: {},
      }
    );

    const actor = await programFolio.account.actor.fetch(
      getActorPDA(tradeLauncherKeypair.publicKey, folioPDA)
    );

    assert.deepEqual(actor.roles, 4); //  binary 100 = 4 for trade launcher
    assert.deepEqual(actor.authority, tradeLauncherKeypair.publicKey);
    assert.deepEqual(actor.folio, folioPDA);
    assert.notEqual(actor.bump, 0);
  });

  it("should update trade proposer to also have trade launcher role", async () => {
    await addOrUpdateActor(
      connection,
      folioOwnerKeypair,
      folioPDA,
      tradeProposerKeypair.publicKey,
      {
        tradeLauncher: {},
      }
    );

    const actor = await programFolio.account.actor.fetch(
      getActorPDA(tradeProposerKeypair.publicKey, folioPDA)
    );

    assert.deepEqual(actor.roles, 6); //  binary 110 = 6 for trade approver and trade launcher
    assert.deepEqual(actor.authority, tradeProposerKeypair.publicKey);
    assert.deepEqual(actor.folio, folioPDA);
    assert.notEqual(actor.bump, 0);
  });

  it("should remove trade launcher", async () => {
    await removeActor(
      connection,
      folioOwnerKeypair,
      folioPDA,
      tradeLauncherKeypair.publicKey,
      {
        tradeLauncher: {},
      },
      true
    );

    await wait(2);

    const actor = await programFolio.account.actor.fetchNullable(
      getActorPDA(tradeLauncherKeypair.publicKey, folioPDA)
    );

    // Null since we closed it
    assert.equal(actor, null);

    // Just to test re-init attack, we'll re-init the actor and see the fields
    await airdrop(
      connection,
      getActorPDA(tradeLauncherKeypair.publicKey, folioPDA),
      1000
    );

    const actorPostReinit = await programFolio.account.actor.fetchNullable(
      getActorPDA(tradeLauncherKeypair.publicKey, folioPDA)
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

    const folioBefore = await programFolio.account.folio.fetch(folioPDA);

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
      folioAfter.daoPendingFeeShares.eq(
        folioBefore.daoPendingFeeShares.add(new BN(1500001))
      ),
      true
    );
    assert.equal(
      folioAfter.feeRecipientsPendingFeeShares.eq(
        folioBefore.feeRecipientsPendingFeeShares.add(new BN(1499999))
      ),
      true
    );

    // Take 30% (3 tokens and 10 is the supply)
    folioTestHelper.assertBalanceSnapshot(
      beforeSnapshot,
      afterSnapshot,
      Array.from({ length: 5 }).map((_, i) => [
        -30 * 10 ** tokenMints[i].decimals,
        -30 * 10 ** tokenMints[i].decimals,
      ]),
      [],
      // Receives a bit less than 3 tokens because of the fees
      [0, 2.997],
      [0, 1, 2, 3, 4]
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
        20.004616449 * 10 ** tokenMints[i].decimals,
        20.004616449 * 10 ** tokenMints[i].decimals,
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

    assert.equal(daoFeeDiff.gt(new BN(0)), true);
    assert.equal(recipientFeeDiff.gt(new BN(0)), true);
  });

  it("should allow user to distribute fees", async () => {
    const daoFeeConfig = await programDtf.account.daoFeeConfig.fetch(
      getDAOFeeConfigPDA()
    );

    const folioBefore = await programFolio.account.folio.fetch(folioPDA);

    const feeRecipientBefore = await programFolio.account.feeRecipients.fetch(
      getFolioFeeRecipientsPDA(folioPDA)
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
      getFolioFeeRecipientsPDA(folioPDA)
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
    assert.equal(folioBefore.feeRecipientsPendingFeeShares.gt(new BN(0)), true);
    assert.equal(folioAfter.feeRecipientsPendingFeeShares.eq(new BN(0)), true);
    assert.equal(folioAfter.daoPendingFeeShares.eq(new BN(0)), true);

    // Fee recipient's index should be updated
    assert.equal(
      feeRecipientAfter.distributionIndex.toNumber(),
      feeRecipientBefore.distributionIndex.toNumber() + 1
    );

    // Folio distribution should be created
    assert.equal(feeDistribution.index.toNumber(), 1);
    assert.equal(feeDistribution.amountToDistribute.toNumber() > 0, true);
    assert.deepEqual(feeDistribution.folio, folioPDA);
    assert.deepEqual(feeDistribution.cranker, userKeypair.publicKey);
    assert.equal(
      feeDistribution.feeRecipientsState[0].receiver.toBase58(),
      newFeeRecipient[0].receiver.toBase58()
    );
    assert.equal(
      feeDistribution.feeRecipientsState[1].receiver.toBase58(),
      newFeeRecipient[1].receiver.toBase58()
    );
  });

  it("should allow user to crank fee distribution", async () => {
    const newRecipient1ATA = await getOrCreateAtaAddress(
      connection,
      folioTokenMint.publicKey,
      userKeypair,
      newFeeRecipient[0].receiver
    );
    const newRecipient2ATA = await getOrCreateAtaAddress(
      connection,
      folioTokenMint.publicKey,
      userKeypair,
      newFeeRecipient[1].receiver
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

  it("should allow user to approve trade", async () => {
    const sellMint = tokenMints[1].mint.publicKey;

    const currentTimeOnSolana = await getSolanaCurrentTime(connection);
    const folio = await programFolio.account.folio.fetch(folioPDA);

    const ttl = new BN(1000000000);

    await approveTrade(
      connection,
      tradeProposerKeypair,
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

    const trade = await programFolio.account.trade.fetch(
      getTradePDA(folioPDA, new BN(1))
    );

    assert.equal(trade.id.toNumber(), 1);
    assert.equal(trade.folio.toBase58(), folioPDA.toBase58());
    assert.equal(trade.sell.toBase58(), sellMint.toBase58());
    assert.equal(trade.buy.toBase58(), buyMint.publicKey.toBase58());
    assert.equal(trade.sellLimit.spot.eq(new BN(1)), true);
    assert.equal(trade.sellLimit.low.eq(new BN(0)), true);
    assert.equal(trade.sellLimit.high.eq(new BN(2)), true);
    assert.equal(trade.buyLimit.spot.eq(new BN(1)), true);
    assert.equal(trade.buyLimit.low.eq(new BN(0)), true);
    assert.equal(trade.buyLimit.high.eq(new BN(2)), true);
    assert.equal(trade.startPrice.eq(new BN(2)), true);
    assert.equal(trade.endPrice.eq(new BN(1)), true);
    assert.equal(
      trade.availableAt.toNumber() >=
        currentTimeOnSolana + folio.tradeDelay.toNumber(),
      true
    );
    assert.equal(
      trade.launchTimeout.toNumber() >= currentTimeOnSolana + ttl.toNumber(),
      true
    );
    assert.equal(trade.start.eq(new BN(0)), true);
    assert.equal(trade.end.eq(new BN(0)), true);
    assert.equal(deserializeU256(trade.k.value) === BigInt(0), true);
  });

  it("should allow user to open trade", async () => {
    const tradePDA = getTradePDA(folioPDA, new BN(1));
    const folio = await programFolio.account.folio.fetch(folioPDA);

    const currentTimeOnSolana = await getSolanaCurrentTime(connection);

    await openTrade(
      connection,
      // Trade launcher is removed in the test above, but proposer gets the 2 roles
      tradeProposerKeypair,
      folioPDA,
      tradePDA,
      new BN(2),
      new BN(2),
      new BN(2),
      new BN(1)
    );

    const trade = await programFolio.account.trade.fetch(tradePDA);

    // Update limits and prices
    assert.equal(trade.sellLimit.spot.eq(new BN(2)), true);
    assert.equal(trade.buyLimit.spot.eq(new BN(2)), true);
    assert.equal(trade.startPrice.eq(new BN(2)), true);
    assert.equal(trade.endPrice.eq(new BN(1)), true);

    // Assert trade is opened
    assert.equal(trade.start.toNumber() >= currentTimeOnSolana, true);
    assert.equal(
      trade.end.toNumber() >=
        currentTimeOnSolana + folio.auctionLength.toNumber(),
      true
    );

    assert.equal(
      deserializeU256(trade.k.value) === BigInt(1146076687433),
      true
    );
  });

  it.skip("should allow trade actor to kill trade", async () => {
    const tradePDA = getTradePDA(folioPDA, new BN(1));
    const trade = await programFolio.account.trade.fetch(tradePDA);

    const folioBefore = await programFolio.account.folio.fetch(folioPDA);

    const tradeEndBuyBefore = folioBefore.tradeEnds.find(
      (tradeEnd) => tradeEnd.mint.toBase58() === trade.buy.toBase58()
    );
    const tradeEndSellBefore = folioBefore.tradeEnds.find(
      (tradeEnd) => tradeEnd.mint.toBase58() === trade.sell.toBase58()
    );

    const currentTimeOnSolana = await getSolanaCurrentTime(connection);

    await killTrade(connection, tradeProposerKeypair, folioPDA, tradePDA);

    const folioAfter = await programFolio.account.folio.fetch(folioPDA);

    assert.equal(
      (await programFolio.account.trade.fetch(tradePDA)).end.toNumber(),
      1
    );

    const tradeEndBuyAfter = folioAfter.tradeEnds.find(
      (tradeEnd) => tradeEnd.mint.toBase58() === trade.buy.toBase58()
    );
    const tradeEndSellAfter = folioAfter.tradeEnds.find(
      (tradeEnd) => tradeEnd.mint.toBase58() === trade.sell.toBase58()
    );

    assert.notEqual(
      tradeEndBuyAfter!.endTime.toNumber(),
      tradeEndBuyBefore!.endTime.toNumber()
    );
    assert.notEqual(
      tradeEndSellAfter!.endTime.toNumber(),
      tradeEndSellBefore!.endTime.toNumber()
    );

    assert.equal(
      tradeEndBuyAfter!.endTime.toNumber() >= currentTimeOnSolana,
      true
    );
    assert.equal(
      tradeEndSellAfter!.endTime.toNumber() >= currentTimeOnSolana,
      true
    );
  });

  it("should allow user to bid without callback", async () => {
    const tradePDA = getTradePDA(folioPDA, new BN(1));
    const tradeFetched = await programFolio.account.trade.fetch(tradePDA);

    const buyMint = await getMint(connection, tradeFetched.buy);
    const sellMint = await getMint(connection, tradeFetched.sell);

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
      tradePDA,
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
    const tradePDA = getTradePDA(folioPDA, new BN(1));
    const tradeFetched = await programFolio.account.trade.fetch(tradePDA);

    const buyMint = await getMint(connection, tradeFetched.buy);
    const sellMint = await getMint(connection, tradeFetched.sell);

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
      tradePDA,
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
      [0, 1]
    );
  });

  it("should allow user to add reward token", async () => {
    await addRewardToken(
      connection,
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
    assert.equal(
      deserializeU256(folioRewardTokens.rewardRatio.value) ===
        BigInt(8022536812036),
      true
    );
    assert.deepEqual(folioRewardTokens.folio, folioPDA);
    assert.notEqual(folioRewardTokens.bump, 0);
  });

  it("should allow user to init or set reward ratio", async () => {
    await initOrSetRewardRatio(
      connection,
      folioOwnerKeypair,
      folioPDA,
      new BN(604800)
    );

    const folioRewardTokensAfter =
      await programFolio.account.folioRewardTokens.fetch(
        getFolioRewardTokensPDA(folioPDA)
      );

    assert.equal(
      deserializeU256(folioRewardTokensAfter.rewardRatio.value) ===
        BigInt(1146076687433),
      true
    );
  });

  it("should allow user to remove reward token", async () => {
    await removeRewardToken(
      connection,
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

  it("should allow user to accrue rewards, after adding 1 more reward tokens", async () => {
    // Adding the tokens
    await addRewardToken(
      connection,
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
    await mintToken(
      connection,
      adminKeypair,
      rewardTokenMints[1].mint.publicKey,
      1_000,
      folioRewardTokenPDA
    );

    // First accrue rewards will be 0 since the balance unaccounted for is 0, so we'll call it twice
    // Calling accrue rewards
    await accrueRewards(
      connection,
      userKeypair,
      folioOwnerKeypair.publicKey,
      folioPDA,
      folioTokenMint.publicKey,
      [rewardTokenMints[1].mint.publicKey],
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
    await wait(10);

    // Second call will accrue rewards
    await accrueRewards(
      connection,
      userKeypair,
      folioOwnerKeypair.publicKey,
      folioPDA,
      folioTokenMint.publicKey,
      [rewardTokenMints[1].mint.publicKey],
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
      deserializeU256(rewardInfoAfterSecondCall.rewardIndex.value) >
        deserializeU256(rewardInfoBefore.rewardIndex.value),
      true
    );
    assert.equal(
      rewardInfoAfterSecondCall.balanceAccounted.toNumber() >
        rewardInfoBefore.balanceAccounted.toNumber(),
      true
    );
    assert.equal(
      rewardInfoAfterSecondCall.payoutLastPaid.toNumber() >
        rewardInfoBefore.payoutLastPaid.toNumber(),
      true
    );

    assert.equal(userInfoRewardAfter.folio.toBase58(), folioPDA.toBase58());
    assert.equal(
      userInfoRewardAfter.folioRewardToken.toBase58(),
      rewardTokenMints[1].mint.publicKey.toBase58()
    );
    assert.notEqual(userInfoRewardAfter.bump, 0);
    assert.equal(userInfoRewardAfter.accruedRewards.gt(new BN(0)), true);
    assert.equal(
      deserializeU256(userInfoRewardAfter.lastRewardIndex.value),
      deserializeU256(rewardInfoAfterSecondCall.rewardIndex.value)
    );
  });

  it("should allow user to claim rewards", async () => {
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
