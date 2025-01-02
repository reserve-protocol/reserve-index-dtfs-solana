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
  getFolioPendingTokenAmountsPDA,
  getUserPendingTokenAmountsPDA,
} from "../utils/pda-helper";
import {
  addOrUpdateActor,
  addTokensToFolio,
  finalizeFolio,
  initDtfSigner,
  initOrAddMintFolioToken,
  mintFolioToken,
  removeActor,
  removeFromMintFolioToken,
  resizeFolio,
  updateFolio,
} from "../utils/dtf-helper";
import {
  DEFAULT_DECIMALS_MUL,
  DEFAULT_PRECISION,
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

  let tradeApproverKeypair: Keypair;

  let folioOwnerKeypair: Keypair;
  let folioTokenMint: Keypair;
  let folioPDA: PublicKey;

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
    tradeApproverKeypair = Keypair.generate();

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
  //   assert.deepEqual(folioAfter.feePerSecond, folioBefore.feePerSecond);
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
  //   assert.deepEqual(folioAfter.feePerSecond, folioBefore.feePerSecond);
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
      await program.account.folioFeeRecipients.fetchNullable(
        getFolioFeeRecipientsPDA(folioPDA)
      );

    await updateFolio(
      connection,
      folioOwnerKeypair,
      folioPDA,
      null,
      null,
      folioBefore.feePerSecond.add(new BN(1)),
      [],
      []
    );

    const folioAfter = await program.account.folio.fetch(folioPDA);
    const feeRecipientsAfter = await program.account.folioFeeRecipients.fetch(
      getFolioFeeRecipientsPDA(folioPDA)
    );

    assert.deepEqual(folioAfter.programVersion, folioBefore.programVersion);
    assert.equal(
      folioAfter.programDeploymentSlot.toNumber(),
      folioBefore.programDeploymentSlot.toNumber()
    );
    assert.equal(
      folioAfter.feePerSecond.toNumber(),
      folioBefore.feePerSecond.add(new BN(1)).toNumber()
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
      folioBefore.feePerSecond,
      [],
      []
    );
  });

  it("should update fee recipients of folio", async () => {
    const folioBefore = await program.account.folio.fetch(folioPDA);
    const feeRecipientsBefore = await program.account.folioFeeRecipients.fetch(
      getFolioFeeRecipientsPDA(folioPDA)
    );

    let newFeeRecipient = [
      {
        receiver: Keypair.generate().publicKey,
        share: new BN(1_000_000_000 * 0.6),
      },
      {
        receiver: Keypair.generate().publicKey,
        share: new BN(1_000_000_000 * 0.4),
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
    const feeRecipientsAfter = await program.account.folioFeeRecipients.fetch(
      getFolioFeeRecipientsPDA(folioPDA)
    );

    assert.deepEqual(folioAfter.programVersion, folioBefore.programVersion);
    assert.equal(
      folioAfter.programDeploymentSlot.toNumber(),
      folioBefore.programDeploymentSlot.toNumber()
    );
    assert.equal(
      folioAfter.feePerSecond.toNumber(),
      folioBefore.feePerSecond.toNumber()
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
      tradeApproverKeypair.publicKey,
      {
        tradeApprover: {},
      }
    );

    const actor = await program.account.actor.fetch(
      getActorPDA(tradeApproverKeypair.publicKey, folioPDA)
    );

    assert.deepEqual(actor.roles, 2); //  binary 10 = 2 for trade approver
    assert.deepEqual(actor.authority, tradeApproverKeypair.publicKey);
    assert.deepEqual(actor.folio, folioPDA);
    assert.notEqual(actor.bump, 0);
  });

  it("should update trade approver to also have price curator role", async () => {
    await addOrUpdateActor(
      connection,
      folioOwnerKeypair,
      folioPDA,
      tradeApproverKeypair.publicKey,
      {
        priceCurator: {},
      }
    );

    const actor = await program.account.actor.fetch(
      getActorPDA(tradeApproverKeypair.publicKey, folioPDA)
    );

    assert.deepEqual(actor.roles, 6); //  binary 110 = 6 for trade approver and price curator
    assert.deepEqual(actor.authority, tradeApproverKeypair.publicKey);
    assert.deepEqual(actor.folio, folioPDA);
    assert.notEqual(actor.bump, 0);
  });

  it("should remove trade approver", async () => {
    await removeActor(
      connection,
      folioOwnerKeypair,
      folioPDA,
      tradeApproverKeypair.publicKey,
      {
        tradeApprover: {},
      },
      true
    );

    await wait(2);

    const actor = await program.account.actor.fetchNullable(
      getActorPDA(tradeApproverKeypair.publicKey, folioPDA)
    );

    // Null since we closed it
    assert.equal(actor, null);

    // // Just to test re-init attack, we'll re-init the actor and see the fields
    await airdrop(
      connection,
      getActorPDA(tradeApproverKeypair.publicKey, folioPDA),
      1000
    );

    const actorPostReinit = await program.account.actor.fetchNullable(
      getActorPDA(tradeApproverKeypair.publicKey, folioPDA)
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

    await addTokensToFolio(connection, folioOwnerKeypair, folioPDA, [
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

    await addTokensToFolio(
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

    await finalizeFolio(
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
    await initOrAddMintFolioToken(connection, userKeypair, folioPDA, [
      {
        mint: tokenMints[0].mint.publicKey,
        amount: new BN(100 * 10 ** tokenMints[0].decimals),
      },
    ]);

    const userPendingTokenAmountsPDA = getUserPendingTokenAmountsPDA(
      folioPDA,
      userKeypair.publicKey,
      true
    );

    const folioPendingTokenAmountsPDA =
      getFolioPendingTokenAmountsPDA(folioPDA);

    const userPendingTokenAmounts =
      await program.account.pendingTokenAmounts.fetch(
        userPendingTokenAmountsPDA
      );

    const folioPendingTokenAmounts =
      await program.account.pendingTokenAmounts.fetch(
        folioPendingTokenAmountsPDA
      );

    assert.equal(
      userPendingTokenAmounts.tokenAmounts[0].amount.toNumber(),
      100 * 10 ** tokenMints[0].decimals
    );

    assert.equal(
      folioPendingTokenAmounts.tokenAmounts[0].amount.toNumber(),
      100 * 10 ** tokenMints[0].decimals
    );
  });

  it("should allow user to add to mint folio tokens", async () => {
    const userPendingTokenAmountsPDA = getUserPendingTokenAmountsPDA(
      folioPDA,
      userKeypair.publicKey,
      true
    );
    const folioPendingTokenAmountsPDA =
      getFolioPendingTokenAmountsPDA(folioPDA);

    const userPendingTokenAmountsBefore =
      await program.account.pendingTokenAmounts.fetch(
        userPendingTokenAmountsPDA
      );

    const folioPendingTokenAmountsBefore =
      await program.account.pendingTokenAmounts.fetch(
        folioPendingTokenAmountsPDA
      );

    await initOrAddMintFolioToken(connection, userKeypair, folioPDA, [
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

    const userPendingTokenAmountsAfter =
      await program.account.pendingTokenAmounts.fetch(
        userPendingTokenAmountsPDA
      );

    const folioPendingTokenAmountsAfter =
      await program.account.pendingTokenAmounts.fetch(
        folioPendingTokenAmountsPDA
      );

    assert.equal(
      userPendingTokenAmountsAfter.tokenAmounts[0].amount.toNumber(),
      userPendingTokenAmountsBefore.tokenAmounts[0].amount.toNumber()
    );

    assert.equal(
      folioPendingTokenAmountsAfter.tokenAmounts[0].amount.toNumber(),
      folioPendingTokenAmountsBefore.tokenAmounts[0].amount.toNumber()
    );

    assert.equal(
      userPendingTokenAmountsAfter.tokenAmounts[1].amount.toNumber(),
      userPendingTokenAmountsBefore.tokenAmounts[1].amount.toNumber() +
        100 * 10 ** tokenMints[1].decimals
    );

    assert.equal(
      folioPendingTokenAmountsAfter.tokenAmounts[1].amount.toNumber(),
      folioPendingTokenAmountsBefore.tokenAmounts[1].amount.toNumber() +
        100 * 10 ** tokenMints[1].decimals
    );

    assert.equal(
      userPendingTokenAmountsAfter.tokenAmounts[2].amount.toNumber(),
      userPendingTokenAmountsBefore.tokenAmounts[2].amount.toNumber() +
        200 * 10 ** tokenMints[2].decimals
    );

    assert.equal(
      folioPendingTokenAmountsAfter.tokenAmounts[2].amount.toNumber(),
      folioPendingTokenAmountsBefore.tokenAmounts[2].amount.toNumber() +
        200 * 10 ** tokenMints[2].decimals
    );

    assert.equal(
      userPendingTokenAmountsAfter.tokenAmounts[3].amount.toNumber(),
      userPendingTokenAmountsBefore.tokenAmounts[3].amount.toNumber() +
        300 * 10 ** tokenMints[3].decimals
    );
    assert.equal(
      folioPendingTokenAmountsAfter.tokenAmounts[3].amount.toNumber(),
      folioPendingTokenAmountsBefore.tokenAmounts[3].amount.toNumber() +
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

    const userPendingTokenAmountsPDA = getUserPendingTokenAmountsPDA(
      folioPDA,
      userKeypair.publicKey,
      true
    );

    const folioPendingTokenAmountsPDA =
      getFolioPendingTokenAmountsPDA(folioPDA);

    const userPendingTokenAmountsBefore =
      await program.account.pendingTokenAmounts.fetch(
        userPendingTokenAmountsPDA
      );

    const folioPendingTokenAmountsBefore =
      await program.account.pendingTokenAmounts.fetch(
        folioPendingTokenAmountsPDA
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

    const userPendingTokenAmountsAfter =
      await program.account.pendingTokenAmounts.fetch(
        userPendingTokenAmountsPDA
      );

    const userFolioTokenBalanceAfter = await getTokenBalance(
      connection,
      userFolioMintATA
    );

    const folioPendingTokenAmountsAfter =
      await program.account.pendingTokenAmounts.fetch(
        folioPendingTokenAmountsPDA
      );

    assert.equal(userFolioTokenBalanceAfter, userFolioTokenBalanceBefore);

    for (
      let i = 0;
      i < userPendingTokenAmountsBefore.tokenAmounts.length;
      i++
    ) {
      assert.equal(
        userPendingTokenAmountsAfter.tokenAmounts[i].amount.toNumber(),
        userPendingTokenAmountsBefore.tokenAmounts[i].amount.toNumber()
      );

      assert.equal(
        folioPendingTokenAmountsAfter.tokenAmounts[i].amount.toNumber(),
        folioPendingTokenAmountsBefore.tokenAmounts[i].amount.toNumber()
      );
    }
  });

  it("should allow user to remove pending token from token #4", async () => {
    // Only remove 100 so we can still mint
    const userPendingTokenAmountsPDA = getUserPendingTokenAmountsPDA(
      folioPDA,
      userKeypair.publicKey,
      true
    );
    const folioPendingTokenAmountsPDA =
      getFolioPendingTokenAmountsPDA(folioPDA);

    const userPendingTokenAmountsBefore =
      await program.account.pendingTokenAmounts.fetch(
        userPendingTokenAmountsPDA
      );

    const folioPendingTokenAmountsBefore =
      await program.account.pendingTokenAmounts.fetch(
        folioPendingTokenAmountsPDA
      );

    await removeFromMintFolioToken(connection, userKeypair, folioPDA, [
      {
        mint: tokenMints[3].mint.publicKey,
        amount: new BN(100 * 10 ** tokenMints[3].decimals),
      },
    ]);

    const userPendingTokenAmountsAfter =
      await program.account.pendingTokenAmounts.fetch(
        userPendingTokenAmountsPDA
      );

    const folioPendingTokenAmountsAfter =
      await program.account.pendingTokenAmounts.fetch(
        folioPendingTokenAmountsPDA
      );

    assert.equal(
      userPendingTokenAmountsAfter.tokenAmounts[3].amount.toNumber(),
      userPendingTokenAmountsBefore.tokenAmounts[3].amount.toNumber() -
        100 * 10 ** tokenMints[3].decimals
    );

    assert.equal(
      folioPendingTokenAmountsAfter.tokenAmounts[3].amount.toNumber(),
      folioPendingTokenAmountsBefore.tokenAmounts[3].amount.toNumber() -
        100 * 10 ** tokenMints[3].decimals
    );
  });

  it("should allow user to mint folio token (after adding 5th token)", async () => {
    await initOrAddMintFolioToken(connection, userKeypair, folioPDA, [
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

    const userPendingTokenAmountsPDA = getUserPendingTokenAmountsPDA(
      folioPDA,
      userKeypair.publicKey,
      true
    );
    const folioPendingTokenAmountsPDA =
      getFolioPendingTokenAmountsPDA(folioPDA);

    const userPendingTokenAmountsBefore =
      await program.account.pendingTokenAmounts.fetch(
        userPendingTokenAmountsPDA
      );

    const folioPendingTokenAmountsBefore =
      await program.account.pendingTokenAmounts.fetch(
        folioPendingTokenAmountsPDA
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

    const userPendingTokenAmountsAfter =
      await program.account.pendingTokenAmounts.fetch(
        userPendingTokenAmountsPDA
      );

    const folioPendingTokenAmountsAfter =
      await program.account.pendingTokenAmounts.fetch(
        folioPendingTokenAmountsPDA
      );

    const userFolioTokenBalanceAfter = await getTokenBalance(
      connection,
      userFolioMintATA
    );

    assert.equal(userFolioTokenBalanceAfter, userFolioTokenBalanceBefore + 3);

    // Take 30% (3 tokens and 10 is the supply)
    assert.equal(
      userPendingTokenAmountsAfter.tokenAmounts[0].amount.toNumber(),
      userPendingTokenAmountsBefore.tokenAmounts[0].amount.toNumber() -
        30 * 10 ** tokenMints[0].decimals
    );

    assert.equal(
      folioPendingTokenAmountsAfter.tokenAmounts[0].amount.toNumber(),
      folioPendingTokenAmountsBefore.tokenAmounts[0].amount.toNumber() -
        30 * 10 ** tokenMints[0].decimals
    );

    assert.equal(
      userPendingTokenAmountsAfter.tokenAmounts[1].amount.toNumber(),
      userPendingTokenAmountsBefore.tokenAmounts[1].amount.toNumber() -
        30 * 10 ** tokenMints[1].decimals
    );

    assert.equal(
      folioPendingTokenAmountsAfter.tokenAmounts[1].amount.toNumber(),
      folioPendingTokenAmountsBefore.tokenAmounts[1].amount.toNumber() -
        30 * 10 ** tokenMints[1].decimals
    );

    assert.equal(
      userPendingTokenAmountsAfter.tokenAmounts[2].amount.toNumber(),
      userPendingTokenAmountsBefore.tokenAmounts[2].amount.toNumber() -
        60 * 10 ** tokenMints[2].decimals
    );

    assert.equal(
      folioPendingTokenAmountsAfter.tokenAmounts[2].amount.toNumber(),
      folioPendingTokenAmountsBefore.tokenAmounts[2].amount.toNumber() -
        60 * 10 ** tokenMints[2].decimals
    );

    assert.equal(
      userPendingTokenAmountsAfter.tokenAmounts[3].amount.toNumber(),
      userPendingTokenAmountsBefore.tokenAmounts[3].amount.toNumber() -
        60 * 10 ** tokenMints[3].decimals
    );

    assert.equal(
      folioPendingTokenAmountsAfter.tokenAmounts[3].amount.toNumber(),
      folioPendingTokenAmountsBefore.tokenAmounts[3].amount.toNumber() -
        60 * 10 ** tokenMints[3].decimals
    );

    assert.equal(
      userPendingTokenAmountsAfter.tokenAmounts[4].amount.toNumber(),
      userPendingTokenAmountsBefore.tokenAmounts[4].amount.toNumber() -
        30 * 10 ** tokenMints[4].decimals
    );

    assert.equal(
      folioPendingTokenAmountsAfter.tokenAmounts[4].amount.toNumber(),
      folioPendingTokenAmountsBefore.tokenAmounts[4].amount.toNumber() -
        30 * 10 ** tokenMints[4].decimals
    );
  });
});
