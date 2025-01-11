import {
  airdrop,
  assertThrows,
  getConnectors,
  wait,
} from "../utils/program-helper";
import { Dtfs } from "../target/types/dtfs";
import { Folio } from "../target/types/folio";
import { BN, Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  initFolio,
  initFolioSigner,
  initProgramRegistrar,
  pokeFolio,
} from "../utils/folio-helper";
import * as assert from "assert";
import {
  DTF_PROGRAM_ID,
  getActorPDA,
  getDAOFeeConfigPDA,
  getDtfSignerPDA,
  getFolioFeeRecipientsPDA,
  getFolioPendingBasketPDA,
  getUserPendingBasketPDA,
} from "../utils/pda-helper";
import {
  addOrUpdateActor,
  addToBasket,
  burnFolioToken,
  initDtfSigner,
  addToPendingBasket,
  mintFolioToken,
  redeemFromPendingBasket,
  removeActor,
  removeFromPendingBasket,
  resizeFolio,
  updateFolio,
  setDaoFeeConfig,
  MAX_FOLIO_FEE,
  MIN_DAO_MINTING_FEE,
  SCALAR,
  MAX_AUCTION_LENGTH,
  MAX_TRADE_DELAY,
} from "../utils/dtf-helper";
import {
  DEFAULT_DECIMALS_MUL,
  initToken,
  mintToken,
} from "../utils/token-helper";
import { TestHelper } from "../utils/test-helper";

describe("DTFs Tests", () => {
  let connection: Connection;
  let program: Program<Folio>;
  let programDtf: Program<Dtfs>;
  let keys: any;

  let payerKeypair: Keypair;
  let adminKeypair: Keypair;
  let userKeypair: Keypair;

  let tradeProposerKeypair: Keypair;

  let folioOwnerKeypair: Keypair;
  let folioTokenMint: Keypair;
  let folioPDA: PublicKey;

  let feeRecipient: PublicKey = Keypair.generate().publicKey;
  let feeRecipientNumerator: BN = new BN(600_000_000); //60%

  let folioTestHelper: TestHelper;

  /*
  Tokens that can be included in the folio
  */
  let tokenMints = [
    { mint: Keypair.generate(), decimals: 9 },
    { mint: Keypair.generate(), decimals: 9 },
    { mint: Keypair.generate(), decimals: 5 },
    { mint: Keypair.generate(), decimals: 9 },
    { mint: Keypair.generate(), decimals: 9 },
  ];

  let folioInitTime: number;

  before(async () => {
    ({
      connection,
      programFolio: program,
      programDtf,
      keys,
    } = await getConnectors());

    payerKeypair = Keypair.fromSecretKey(Uint8Array.from(keys.payer));
    adminKeypair = Keypair.fromSecretKey(Uint8Array.from(keys.admin));

    folioOwnerKeypair = Keypair.generate();
    userKeypair = Keypair.generate();
    tradeProposerKeypair = Keypair.generate();

    await airdrop(connection, payerKeypair.publicKey, 1000);
    await airdrop(connection, adminKeypair.publicKey, 1000);
    await airdrop(connection, folioOwnerKeypair.publicKey, 1000);
    await airdrop(connection, userKeypair.publicKey, 1000);

    // Init folio related accounts
    await initFolioSigner(connection, payerKeypair);
    await initProgramRegistrar(connection, adminKeypair, DTF_PROGRAM_ID);
    ({ folioTokenMint, folioPDA } = await initFolio(
      connection,
      folioOwnerKeypair,
      MAX_FOLIO_FEE,
      MIN_DAO_MINTING_FEE.mul(new BN(2)),
      MAX_TRADE_DELAY,
      MAX_AUCTION_LENGTH,
      "Test Folio",
      "TFOL"
    ));

    // To track how much time is passing, so we can calculate fees
    folioInitTime = new Date().getTime() / 1000;

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

    folioTestHelper = new TestHelper(
      connection,
      payerKeypair,
      program,
      folioPDA,
      folioTokenMint.publicKey,
      userKeypair.publicKey,
      tokenMints
    );
  });

  it("should initialize dtf program signer", async () => {
    await initDtfSigner(connection, adminKeypair);

    const dtfSignerPDA = getDtfSignerPDA();

    const dtfSigner = await programDtf.account.dtfProgramSigner.fetch(
      dtfSignerPDA
    );
    assert.notEqual(dtfSigner.bump, 0);
  });

  it("should set the dao fee config", async () => {
    await setDaoFeeConfig(
      connection,
      adminKeypair,
      feeRecipient,
      feeRecipientNumerator
    );

    const daoFeeConfigPDA = getDAOFeeConfigPDA();

    const daoFeeConfig = await programDtf.account.daoFeeConfig.fetch(
      daoFeeConfigPDA
    );

    assert.notEqual(daoFeeConfig.bump, 0);
    assert.deepEqual(daoFeeConfig.feeRecipient, feeRecipient);
    assert.deepEqual(
      daoFeeConfig.feeRecipientNumerator.toNumber(),
      feeRecipientNumerator.toNumber()
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

  // it("should update program version of folio", async () => {
  //   const newProgramVersion = Keypair.generate().publicKey;
  //   await updateProgramRegistrar(
  //     connection,
  //     adminKeypair,
  //     [newProgramVersion],
  //     false
  //   );

  //   const folioBefore = await program.account.folio.fetch(folioPDA);

  //   await updateFolio(
  //     connection,
  //     folioOwnerKeypair,
  //     folioPDA,
  //     folioTokenMint.publicKey,
  //     newProgramVersion,
  //     null,
  //     null,
  //     [],
  //     []
  //   );

  //   const folioAfter = await program.account.folio.fetch(folioPDA);

  //   assert.deepEqual(folioAfter.programVersion, newProgramVersion);
  //   assert.deepEqual(
  //     folioAfter.programDeploymentSlot,
  //     folioBefore.programDeploymentSlot
  //   );
  //   assert.deepEqual(folioAfter.folioFee, folioBefore.folioFee);
  //   assert.deepEqual(folioAfter.feeRecipients, folioBefore.feeRecipients);

  //   // Resetting
  //   await updateFolio(
  //     connection,
  //     folioOwnerKeypair,
  //     folioPDA,
  //     folioTokenMint.publicKey,
  //     DTF_PROGRAM_ID,
  //     null,
  //     null,
  //     [],
  //     []
  //   );
  // });

  // it("should update program deployment slot of folio", async () => {
  //   const folioBefore = await program.account.folio.fetch(folioPDA);

  //   await updateFolio(
  //     connection,
  //     folioOwnerKeypair,
  //     folioPDA,
  //     folioTokenMint.publicKey,
  //     null,
  //     folioBefore.programDeploymentSlot.add(new BN(1)),
  //     null,
  //     [],
  //     []
  //   );

  //   const folioAfter = await program.account.folio.fetch(folioPDA);

  //   assert.deepEqual(folioAfter.programVersion, folioBefore.programVersion);
  //   assert.equal(
  //     folioAfter.programDeploymentSlot.toNumber(),
  //     folioBefore.programDeploymentSlot.add(new BN(1)).toNumber()
  //   );
  //   assert.deepEqual(folioAfter.folioFee, folioBefore.folioFee);
  //   assert.deepEqual(folioAfter.feeRecipients, folioBefore.feeRecipients);

  //   // Resetting
  //   await updateFolio(
  //     connection,
  //     folioOwnerKeypair,
  //     folioPDA,
  //     folioTokenMint.publicKey,
  //     null,
  //     folioBefore.programDeploymentSlot,
  //     null,
  //     [],
  //     []
  //   );
  // });

  it("should update fee per second of folio", async () => {
    const folioBefore = await program.account.folio.fetch(folioPDA);
    const feeRecipientsBefore =
      await program.account.feeRecipients.fetchNullable(
        getFolioFeeRecipientsPDA(folioPDA)
      );

    await updateFolio(
      connection,
      folioOwnerKeypair,
      folioPDA,
      null,
      null,
      new BN(folioBefore.folioFee.toNumber() - 1),
      null,
      null,
      null,
      [],
      []
    );

    const folioAfter = await program.account.folio.fetch(folioPDA);
    const feeRecipientsAfter = await program.account.feeRecipients.fetch(
      getFolioFeeRecipientsPDA(folioPDA)
    );

    assert.deepEqual(folioAfter.programVersion, folioBefore.programVersion);
    assert.equal(
      folioAfter.programDeploymentSlot.toNumber(),
      folioBefore.programDeploymentSlot.toNumber()
    );
    assert.equal(
      folioAfter.folioFee.toNumber(),
      folioBefore.folioFee.toNumber() - 1
    );
    assert.equal(null, feeRecipientsBefore);
    assert.notEqual(null, feeRecipientsAfter);

    // Resetting
    await updateFolio(
      connection,
      folioOwnerKeypair,
      folioPDA,
      null,
      null,
      folioBefore.folioFee,
      null,
      null,

      null,
      [],
      []
    );
  });

  it("should update fee recipients of folio", async () => {
    const folioBefore = await program.account.folio.fetch(folioPDA);
    const feeRecipientsBefore = await program.account.feeRecipients.fetch(
      getFolioFeeRecipientsPDA(folioPDA)
    );

    let newFeeRecipient = [
      {
        receiver: Keypair.generate().publicKey,
        portion: new BN(6).mul(new BN(DEFAULT_DECIMALS_MUL)).div(new BN(10)),
      },
      {
        receiver: Keypair.generate().publicKey,
        portion: new BN(4).mul(new BN(DEFAULT_DECIMALS_MUL)).div(new BN(10)),
      },
    ];

    await updateFolio(
      connection,
      folioOwnerKeypair,
      folioPDA,
      null,
      null,
      null,
      null,
      null,
      null,
      newFeeRecipient,
      []
    );

    const folioAfter = await program.account.folio.fetch(folioPDA);
    const feeRecipientsAfter = await program.account.feeRecipients.fetch(
      getFolioFeeRecipientsPDA(folioPDA)
    );

    assert.deepEqual(folioAfter.programVersion, folioBefore.programVersion);
    assert.equal(
      folioAfter.programDeploymentSlot.toNumber(),
      folioBefore.programDeploymentSlot.toNumber()
    );
    assert.equal(
      folioAfter.folioFee.toNumber(),
      folioBefore.folioFee.toNumber()
    );

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

  it("should add trade approver", async () => {
    await addOrUpdateActor(
      connection,
      folioOwnerKeypair,
      folioPDA,
      tradeProposerKeypair.publicKey,
      {
        tradeProposer: {},
      }
    );

    const actor = await program.account.actor.fetch(
      getActorPDA(tradeProposerKeypair.publicKey, folioPDA)
    );

    assert.deepEqual(actor.roles, 2); //  binary 10 = 2 for trade approver
    assert.deepEqual(actor.authority, tradeProposerKeypair.publicKey);
    assert.deepEqual(actor.folio, folioPDA);
    assert.notEqual(actor.bump, 0);
  });

  it("should update trade approver to also have price curator role", async () => {
    await addOrUpdateActor(
      connection,
      folioOwnerKeypair,
      folioPDA,
      tradeProposerKeypair.publicKey,
      {
        priceCurator: {},
      }
    );

    const actor = await program.account.actor.fetch(
      getActorPDA(tradeProposerKeypair.publicKey, folioPDA)
    );

    assert.deepEqual(actor.roles, 6); //  binary 110 = 6 for trade approver and price curator
    assert.deepEqual(actor.authority, tradeProposerKeypair.publicKey);
    assert.deepEqual(actor.folio, folioPDA);
    assert.notEqual(actor.bump, 0);
  });

  it("should remove trade approver", async () => {
    await removeActor(
      connection,
      folioOwnerKeypair,
      folioPDA,
      tradeProposerKeypair.publicKey,
      {
        tradeProposer: {},
      },
      true
    );

    await wait(2);

    const actor = await program.account.actor.fetchNullable(
      getActorPDA(tradeProposerKeypair.publicKey, folioPDA)
    );

    // Null since we closed it
    assert.equal(actor, null);

    // // Just to test re-init attack, we'll re-init the actor and see the fields
    await airdrop(
      connection,
      getActorPDA(tradeProposerKeypair.publicKey, folioPDA),
      1000
    );

    const actorPostReinit = await program.account.actor.fetchNullable(
      getActorPDA(tradeProposerKeypair.publicKey, folioPDA)
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
    let tokenAmountsToAdd = tokenMints.slice(1).map((token) => ({
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

    const folioAfter = await program.account.folio.fetch(folioPDA);

    assert.equal(folioAfter.status, 1);

    folioTestHelper.assertBalanceSnapshot(
      beforeSnapshot,
      afterSnapshot,
      [],
      [[], [0, 100], [0, 100], [0, 100], [0, 100]],
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

    const folioPendingBasketPDA = getFolioPendingBasketPDA(folioPDA);

    const userPendingBasket = await program.account.pendingBasket.fetch(
      userPendingBasketPDA
    );

    const folioPendingBasket = await program.account.pendingBasket.fetch(
      folioPendingBasketPDA
    );

    assert.equal(
      userPendingBasket.tokenAmounts[0].amountForMinting.toNumber(),
      100 * 10 ** tokenMints[0].decimals
    );

    assert.equal(
      folioPendingBasket.tokenAmounts[0].amountForMinting.toNumber(),
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

    const folioBefore = await program.account.folio.fetch(folioPDA);

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

    const folioAfter = await program.account.folio.fetch(folioPDA);

    const afterSnapshot = await folioTestHelper.getBalanceSnapshot(
      true,
      true,
      false
    );

    assert.equal(
      folioAfter.daoPendingFeeShares.toNumber(),
      folioBefore.daoPendingFeeShares.toNumber() + 1800000
    );
    assert.equal(
      folioAfter.feeRecipientsPendingFeeShares.toNumber(),
      folioBefore.feeRecipientsPendingFeeShares.toNumber() + 1200000
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
    const folioBefore = await program.account.folio.fetch(folioPDA);
    let timeOfPoke = new Date().getTime() / 1000;

    const elapsedTime = timeOfPoke - folioInitTime;

    // MAX_FOLIO_FEE is 13284 in D9 (0.000013284 or about 50% APY)
    const feePerSecond = MAX_FOLIO_FEE.toNumber();

    const estimatedFeeRate = elapsedTime * feePerSecond;

    const totalSupply = folioBefore.daoPendingFeeShares
      .add(folioBefore.feeRecipientsPendingFeeShares)
      .add(
        new BN(
          (
            await connection.getTokenSupply(folioTokenMint.publicKey)
          ).value.amount
        )
      );

    const estimatedFeeShares = totalSupply.muln(estimatedFeeRate).div(SCALAR);

    await pokeFolio(
      connection,
      userKeypair,
      folioPDA,
      folioTokenMint.publicKey
    );

    const folioAfter = await program.account.folio.fetch(folioPDA);

    const daoFeeDiff = folioAfter.daoPendingFeeShares
      .sub(folioBefore.daoPendingFeeShares)
      .toNumber();
    const recipientFeeDiff = folioAfter.feeRecipientsPendingFeeShares
      .sub(folioBefore.feeRecipientsPendingFeeShares)
      .toNumber();

    const totalFeeDiff = daoFeeDiff + recipientFeeDiff;
    assert.equal(
      Math.abs(totalFeeDiff - estimatedFeeShares.toNumber()) <
        totalFeeDiff * 0.2, // 20% tolerance
      true
    );

    assert.equal(
      // 60% of the estimated fee shares
      Math.abs(estimatedFeeShares.toNumber() * 0.6 - daoFeeDiff) <
        daoFeeDiff * 0.2,
      true
    );
    assert.equal(
      Math.abs(estimatedFeeShares.toNumber() * 0.4 - recipientFeeDiff) <
        recipientFeeDiff * 0.2,
      true
    );
  });
});
