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
} from "../utils/folio-helper";
import * as assert from "assert";
import {
  DTF_PROGRAM_ID,
  getActorPDA,
  getDtfSignerPDA,
  getFolioFeeRecipientsPDA,
  getFolioPendingBasketPDA,
  getUserPendingBasketPDA,
} from "../utils/pda-helper";
import {
  addOrUpdateActor,
  addToBasket,
  burnFolioToken,
  finalizeBasket,
  initDtfSigner,
  addToPendingBasket,
  mintFolioToken,
  redeemFromPendingBasket,
  removeActor,
  removeFromPendingBasket,
  resizeFolio,
  updateFolio,
} from "../utils/dtf-helper";
import {
  DEFAULT_DECIMALS_MUL,
  DEFAULT_PRECISION,
  getAtaAddress,
  getOrCreateAtaAddress,
  getTokenBalance,
  initToken,
  mintToken,
} from "../utils/token-helper";

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

  // let folioTestHelper: TestHelper;

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
      new BN(100)
    ));

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

    // folioTestHelper = new TestHelper(
    //   connection,
    //   payerKeypair,
    //   program,
    //   folioPDA,
    //   folioTokenMint.publicKey,
    //   userKeypair.publicKey,
    //   tokenMints
    // );
  });

  it("should initialize dtf program signer", async () => {
    await initDtfSigner(connection, adminKeypair);

    const dtfSignerPDA = getDtfSignerPDA();

    const dtfSigner = await programDtf.account.dtfProgramSigner.fetch(
      dtfSignerPDA
    );
    assert.notEqual(dtfSigner.bump, 0);
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
      folioBefore.folioFee.add(new BN(1)),
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
      folioBefore.folioFee.add(new BN(1)).toNumber()
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
        portion: new BN(1_000_000_000 * 0.6),
      },
      {
        receiver: Keypair.generate().publicKey,
        portion: new BN(1_000_000_000 * 0.4),
      },
    ];

    await updateFolio(
      connection,
      folioOwnerKeypair,
      folioPDA,
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
    const folioATA = await getOrCreateAtaAddress(
      connection,
      tokenMints[0].mint.publicKey,
      folioOwnerKeypair,
      folioPDA
    );

    const folioBalanceBefore = await getTokenBalance(
      connection,
      folioATA,
      false
    );

    await addToBasket(connection, folioOwnerKeypair, folioPDA, [
      {
        mint: tokenMints[0].mint.publicKey,
        amount: new BN(100 * 10 ** tokenMints[0].decimals),
      },
    ]);

    const folioBalanceAfter = await getTokenBalance(
      connection,
      folioATA,
      false
    );

    assert.equal(folioBalanceAfter, folioBalanceBefore + 100);
  });

  it("should add another 4 tokens to the folio", async () => {
    let tokenAmountsToAdd = tokenMints.slice(1).map((token) => ({
      mint: token.mint.publicKey,
      amount: new BN(100 * 10 ** token.decimals),
    }));

    // TODO check all balances in next pr
    const folioATA1 = await getOrCreateAtaAddress(
      connection,
      tokenMints[1].mint.publicKey,
      folioOwnerKeypair,
      folioPDA
    );
    const folioATA2 = await getOrCreateAtaAddress(
      connection,
      tokenMints[2].mint.publicKey,
      folioOwnerKeypair,
      folioPDA
    );

    const folioBalanceBefore1 = await getTokenBalance(
      connection,
      folioATA1,
      false
    );
    const folioBalanceBefore2 = await getTokenBalance(
      connection,
      folioATA2,
      false
    );

    await addToBasket(
      connection,
      folioOwnerKeypair,
      folioPDA,
      tokenAmountsToAdd
    );

    const folioBalanceAfter1 = await getTokenBalance(
      connection,
      folioATA1,
      false
    );
    const folioBalanceAfter2 = await getTokenBalance(
      connection,
      folioATA2,
      false
    );

    assert.equal(folioBalanceAfter1, folioBalanceBefore1 + 100);
    assert.equal(folioBalanceAfter2, folioBalanceBefore2 + 100);
  });

  it("should finalize the folio", async () => {
    const ownerFolioTokenATA = await getOrCreateAtaAddress(
      connection,
      folioTokenMint.publicKey,
      folioOwnerKeypair,
      folioOwnerKeypair.publicKey
    );

    const ownerFolioTokenBalanceBefore = await getTokenBalance(
      connection,
      ownerFolioTokenATA
    );

    await finalizeBasket(
      connection,
      folioOwnerKeypair,
      folioPDA,
      folioTokenMint.publicKey,
      new BN(10 * DEFAULT_DECIMALS_MUL) //10 shares, mint decimals for folio token is 9
    );

    const folioAfter = await program.account.folio.fetch(folioPDA);

    const ownerFolioTokenBalanceAfter = await getTokenBalance(
      connection,
      ownerFolioTokenATA
    );

    assert.equal(folioAfter.status, 1);
    assert.equal(
      ownerFolioTokenBalanceAfter,
      ownerFolioTokenBalanceBefore + 10
    );
  });

  it("should allow user to init mint folio tokens", async () => {
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
    const userPendingBasketPDA = getUserPendingBasketPDA(
      folioPDA,
      userKeypair.publicKey
    );
    const folioPendingBasketPDA = getFolioPendingBasketPDA(folioPDA);

    const userPendingBasketBefore = await program.account.pendingBasket.fetch(
      userPendingBasketPDA
    );

    const folioPendingBasketBefore = await program.account.pendingBasket.fetch(
      folioPendingBasketPDA
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

    const userPendingBasketAfter = await program.account.pendingBasket.fetch(
      userPendingBasketPDA
    );

    const folioPendingBasketAfter = await program.account.pendingBasket.fetch(
      folioPendingBasketPDA
    );

    assert.equal(
      userPendingBasketAfter.tokenAmounts[0].amountForMinting.toNumber(),
      userPendingBasketBefore.tokenAmounts[0].amountForMinting.toNumber()
    );

    assert.equal(
      folioPendingBasketAfter.tokenAmounts[0].amountForMinting.toNumber(),
      folioPendingBasketBefore.tokenAmounts[0].amountForMinting.toNumber()
    );

    assert.equal(
      userPendingBasketAfter.tokenAmounts[1].amountForMinting.toNumber(),
      userPendingBasketBefore.tokenAmounts[1].amountForMinting.toNumber() +
        100 * 10 ** tokenMints[1].decimals
    );

    assert.equal(
      folioPendingBasketAfter.tokenAmounts[1].amountForMinting.toNumber(),
      folioPendingBasketBefore.tokenAmounts[1].amountForMinting.toNumber() +
        100 * 10 ** tokenMints[1].decimals
    );

    assert.equal(
      userPendingBasketAfter.tokenAmounts[2].amountForMinting.toNumber(),
      userPendingBasketBefore.tokenAmounts[2].amountForMinting.toNumber() +
        200 * 10 ** tokenMints[2].decimals
    );

    assert.equal(
      folioPendingBasketAfter.tokenAmounts[2].amountForMinting.toNumber(),
      folioPendingBasketBefore.tokenAmounts[2].amountForMinting.toNumber() +
        200 * 10 ** tokenMints[2].decimals
    );

    assert.equal(
      userPendingBasketAfter.tokenAmounts[3].amountForMinting.toNumber(),
      userPendingBasketBefore.tokenAmounts[3].amountForMinting.toNumber() +
        300 * 10 ** tokenMints[3].decimals
    );
    assert.equal(
      folioPendingBasketAfter.tokenAmounts[3].amountForMinting.toNumber(),
      folioPendingBasketBefore.tokenAmounts[3].amountForMinting.toNumber() +
        300 * 10 ** tokenMints[3].decimals
    );
  });

  it("should not allow user to mint folio token, because missing 5th token", async () => {
    const userFolioMintATA = await getOrCreateAtaAddress(
      connection,
      folioTokenMint.publicKey,
      userKeypair,
      userKeypair.publicKey
    );

    const userPendingBasketPDA = getUserPendingBasketPDA(
      folioPDA,
      userKeypair.publicKey
    );

    const folioPendingBasketPDA = getFolioPendingBasketPDA(folioPDA);

    const userPendingBasketBefore = await program.account.pendingBasket.fetch(
      userPendingBasketPDA
    );

    const folioPendingBasketBefore = await program.account.pendingBasket.fetch(
      folioPendingBasketPDA
    );

    const userFolioTokenBalanceBefore = await getTokenBalance(
      connection,
      userFolioMintATA
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
          new BN(0.1).mul(DEFAULT_PRECISION)
        ),
      "MintMismatch",
      "Should fail when mint mismatch"
    );

    const userPendingBasketAfter = await program.account.pendingBasket.fetch(
      userPendingBasketPDA
    );

    const userFolioTokenBalanceAfter = await getTokenBalance(
      connection,
      userFolioMintATA
    );

    const folioPendingBasketAfter = await program.account.pendingBasket.fetch(
      folioPendingBasketPDA
    );

    assert.equal(userFolioTokenBalanceAfter, userFolioTokenBalanceBefore);

    for (let i = 0; i < userPendingBasketBefore.tokenAmounts.length; i++) {
      assert.equal(
        userPendingBasketAfter.tokenAmounts[i].amountForMinting.toNumber(),
        userPendingBasketBefore.tokenAmounts[i].amountForMinting.toNumber()
      );

      assert.equal(
        folioPendingBasketAfter.tokenAmounts[i].amountForMinting.toNumber(),
        folioPendingBasketBefore.tokenAmounts[i].amountForMinting.toNumber()
      );
    }
  });

  it("should allow user to remove pending token from token #4", async () => {
    // Only remove 100 so we can still mint
    const userPendingBasketPDA = getUserPendingBasketPDA(
      folioPDA,
      userKeypair.publicKey
    );
    const folioPendingBasketPDA = getFolioPendingBasketPDA(folioPDA);

    const userPendingBasketBefore = await program.account.pendingBasket.fetch(
      userPendingBasketPDA
    );

    const folioPendingBasketBefore = await program.account.pendingBasket.fetch(
      folioPendingBasketPDA
    );

    await removeFromPendingBasket(connection, userKeypair, folioPDA, [
      {
        mint: tokenMints[3].mint.publicKey,
        amount: new BN(100 * 10 ** tokenMints[3].decimals),
      },
    ]);

    const userPendingBasketAfter = await program.account.pendingBasket.fetch(
      userPendingBasketPDA
    );

    const folioPendingBasketAfter = await program.account.pendingBasket.fetch(
      folioPendingBasketPDA
    );

    assert.equal(
      userPendingBasketAfter.tokenAmounts[3].amountForMinting.toNumber(),
      userPendingBasketBefore.tokenAmounts[3].amountForMinting.toNumber() -
        100 * 10 ** tokenMints[3].decimals
    );

    assert.equal(
      folioPendingBasketAfter.tokenAmounts[3].amountForMinting.toNumber(),
      folioPendingBasketBefore.tokenAmounts[3].amountForMinting.toNumber() -
        100 * 10 ** tokenMints[3].decimals
    );
  });

  it("should allow user to mint folio token (after adding 5th token)", async () => {
    await addToPendingBasket(connection, userKeypair, folioPDA, [
      {
        mint: tokenMints[4].mint.publicKey,
        amount: new BN(100 * 10 ** tokenMints[4].decimals),
      },
    ]);

    const userFolioMintATA = await getOrCreateAtaAddress(
      connection,
      folioTokenMint.publicKey,
      userKeypair,
      userKeypair.publicKey
    );

    const userPendingBasketPDA = getUserPendingBasketPDA(
      folioPDA,
      userKeypair.publicKey
    );
    const folioPendingBasketPDA = getFolioPendingBasketPDA(folioPDA);

    const userPendingBasketBefore = await program.account.pendingBasket.fetch(
      userPendingBasketPDA
    );

    const folioPendingBasketBefore = await program.account.pendingBasket.fetch(
      folioPendingBasketPDA
    );

    const userFolioTokenBalanceBefore = await getTokenBalance(
      connection,
      userFolioMintATA
    );

    const shares = new BN(3).mul(new BN(10 ** 8));

    await mintFolioToken(
      connection,
      userKeypair,
      folioPDA,
      folioTokenMint.publicKey,
      tokenMints.map((token) => ({
        mint: token.mint.publicKey,
        amount: new BN(0),
      })),
      shares
    );

    const userPendingBasketAfter = await program.account.pendingBasket.fetch(
      userPendingBasketPDA
    );

    const folioPendingBasketAfter = await program.account.pendingBasket.fetch(
      folioPendingBasketPDA
    );

    const userFolioTokenBalanceAfter = await getTokenBalance(
      connection,
      userFolioMintATA
    );

    assert.equal(userFolioTokenBalanceAfter, userFolioTokenBalanceBefore + 3);

    // Take 30% (3 tokens and 10 is the supply)
    assert.equal(
      userPendingBasketAfter.tokenAmounts[0].amountForMinting.toNumber(),
      userPendingBasketBefore.tokenAmounts[0].amountForMinting.toNumber() -
        30 * 10 ** tokenMints[0].decimals
    );

    assert.equal(
      folioPendingBasketAfter.tokenAmounts[0].amountForMinting.toNumber(),
      folioPendingBasketBefore.tokenAmounts[0].amountForMinting.toNumber() -
        30 * 10 ** tokenMints[0].decimals
    );

    assert.equal(
      userPendingBasketAfter.tokenAmounts[1].amountForMinting.toNumber(),
      userPendingBasketBefore.tokenAmounts[1].amountForMinting.toNumber() -
        30 * 10 ** tokenMints[1].decimals
    );

    assert.equal(
      folioPendingBasketAfter.tokenAmounts[1].amountForMinting.toNumber(),
      folioPendingBasketBefore.tokenAmounts[1].amountForMinting.toNumber() -
        30 * 10 ** tokenMints[1].decimals
    );

    assert.equal(
      userPendingBasketAfter.tokenAmounts[2].amountForMinting.toNumber(),
      userPendingBasketBefore.tokenAmounts[2].amountForMinting.toNumber() -
        30 * 10 ** tokenMints[2].decimals
    );

    assert.equal(
      folioPendingBasketAfter.tokenAmounts[2].amountForMinting.toNumber(),
      folioPendingBasketBefore.tokenAmounts[2].amountForMinting.toNumber() -
        30 * 10 ** tokenMints[2].decimals
    );

    assert.equal(
      userPendingBasketAfter.tokenAmounts[3].amountForMinting.toNumber(),
      userPendingBasketBefore.tokenAmounts[3].amountForMinting.toNumber() -
        30 * 10 ** tokenMints[3].decimals
    );

    assert.equal(
      folioPendingBasketAfter.tokenAmounts[3].amountForMinting.toNumber(),
      folioPendingBasketBefore.tokenAmounts[3].amountForMinting.toNumber() -
        30 * 10 ** tokenMints[3].decimals
    );

    assert.equal(
      userPendingBasketAfter.tokenAmounts[4].amountForMinting.toNumber(),
      userPendingBasketBefore.tokenAmounts[4].amountForMinting.toNumber() -
        30 * 10 ** tokenMints[4].decimals
    );

    assert.equal(
      folioPendingBasketAfter.tokenAmounts[4].amountForMinting.toNumber(),
      folioPendingBasketBefore.tokenAmounts[4].amountForMinting.toNumber() -
        30 * 10 ** tokenMints[4].decimals
    );
  });

  it("should allow user to burn folio token (burn 2 tokens)", async () => {
    const userPendingBasketPDA = getUserPendingBasketPDA(
      folioPDA,
      userKeypair.publicKey
    );
    const folioPendingBasketPDA = getFolioPendingBasketPDA(folioPDA);

    const userPendingBasketBefore = await program.account.pendingBasket.fetch(
      userPendingBasketPDA
    );

    const folioPendingBasketBefore = await program.account.pendingBasket.fetch(
      folioPendingBasketPDA
    );

    const userFolioTokenATA = await getOrCreateAtaAddress(
      connection,
      folioTokenMint.publicKey,
      userKeypair,
      userKeypair.publicKey
    );

    const userFolioTokenBalanceBefore = await getTokenBalance(
      connection,
      userFolioTokenATA
    );

    await burnFolioToken(
      connection,
      userKeypair,
      folioPDA,
      folioTokenMint.publicKey,
      new BN(2).mul(DEFAULT_PRECISION),
      tokenMints.map((token) => ({
        mint: token.mint.publicKey,
        amount: new BN(0),
      }))
    );

    const userPendingBasketAfter = await program.account.pendingBasket.fetch(
      userPendingBasketPDA
    );

    const folioPendingBasketAfter = await program.account.pendingBasket.fetch(
      folioPendingBasketPDA
    );

    const userFolioTokenBalanceAfter = await getTokenBalance(
      connection,
      userFolioTokenATA
    );

    assert.equal(userFolioTokenBalanceAfter, userFolioTokenBalanceBefore - 2);

    for (let i = 0; i < tokenMints.length; i++) {
      // Minting token amounts are the same
      assert.equal(
        userPendingBasketAfter.tokenAmounts[i].amountForMinting.toNumber(),
        userPendingBasketBefore.tokenAmounts[i].amountForMinting.toNumber()
      );

      assert.equal(
        folioPendingBasketAfter.tokenAmounts[i].amountForMinting.toNumber(),
        folioPendingBasketBefore.tokenAmounts[i].amountForMinting.toNumber()
      );

      // TODO more precise equal
      assert.equal(
        userPendingBasketAfter.tokenAmounts[i].amountForRedeeming.toNumber() >
          userPendingBasketBefore.tokenAmounts[i].amountForRedeeming.toNumber(),
        true
      );
      assert.equal(
        folioPendingBasketAfter.tokenAmounts[i].amountForRedeeming.toNumber() >
          folioPendingBasketBefore.tokenAmounts[
            i
          ].amountForRedeeming.toNumber(),
        true
      );
    }
  });

  it("should allow user to redeem from burn folio token", async () => {
    let balances = [];
    for (let i = 0; i < tokenMints.length; i++) {
      let userAta = await getOrCreateAtaAddress(
        connection,
        tokenMints[i].mint.publicKey,
        userKeypair,
        userKeypair.publicKey
      );

      balances.push(await getTokenBalance(connection, userAta));
    }

    const userPendingBasketPDA = getUserPendingBasketPDA(
      folioPDA,
      userKeypair.publicKey
    );
    const folioPendingBasketPDA = getFolioPendingBasketPDA(folioPDA);

    const userPendingBasketBefore = await program.account.pendingBasket.fetch(
      userPendingBasketPDA
    );

    const folioPendingBasketBefore = await program.account.pendingBasket.fetch(
      folioPendingBasketPDA
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

    const userPendingBasketAfter = await program.account.pendingBasket.fetch(
      userPendingBasketPDA
    );

    const folioPendingBasketAfter = await program.account.pendingBasket.fetch(
      folioPendingBasketPDA
    );

    for (let i = 0; i < tokenMints.length; i++) {
      const balanceAfter = await getTokenBalance(
        connection,
        await getAtaAddress(tokenMints[i].mint.publicKey, userKeypair.publicKey)
      );

      assert.equal(
        userPendingBasketAfter.tokenAmounts[i].amountForRedeeming.toNumber(),
        userPendingBasketBefore.tokenAmounts[i].amountForRedeeming.toNumber() -
          1 * 10 ** tokenMints[i].decimals
      );

      assert.equal(
        folioPendingBasketAfter.tokenAmounts[i].amountForRedeeming.toNumber(),
        folioPendingBasketBefore.tokenAmounts[i].amountForRedeeming.toNumber() -
          1 * 10 ** tokenMints[i].decimals
      );

      assert.equal(balanceAfter, balances[i] + 1);
    }
  });
});
