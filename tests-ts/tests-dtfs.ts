import { airdrop, getConnectors, wait } from "../utils/program-helper";
import { Dtfs } from "../target/types/dtfs";
import { Folio } from "../target/types/folio";
import { BN, Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  initFolio,
  initFolioSigner,
  initProgramRegistrar,
  mintFolioToken,
  updateProgramRegistrar,
} from "../utils/folio-helper";
import * as assert from "assert";
import {
  DTF_PROGRAM_ID,
  getActorPDA,
  getDtfSignerPDA,
} from "../utils/pda-helper";
import {
  addOrUpdateActor,
  addTokensToFolio,
  finalizeFolio,
  initDtfSigner,
  removeActor,
  resizeFolio,
  updateFolio,
} from "../utils/dtf-helper";
import {
  DEFAULT_DECIMALS,
  getOrCreateAtaAddress,
  getAtaAddress,
  getTokenBalance,
  initToken,
  mintToken,
} from "../utils/token-helper";
import { extendLUT, initLUT } from "../utils/lookup-table-helper";

describe("DTFs Tests", () => {
  let connection: Connection;
  let program: Program<Folio>;
  let programDtf: Program<Dtfs>;
  let keys: any;

  let payerKeypair: Keypair;
  let adminKeypair: Keypair;

  let tradeApproverKeypair: Keypair;
  let priceCuratorKeypair: Keypair;

  let folioOwnerKeypair: Keypair;
  let folioTokenMint: Keypair;
  let folioPDA: PublicKey;

  /*
  Tokens that can be included in the folio
  */
  let tokenMints = [Keypair.generate(), Keypair.generate(), Keypair.generate()];

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
    tradeApproverKeypair = Keypair.generate();
    priceCuratorKeypair = Keypair.generate();

    await airdrop(connection, payerKeypair.publicKey, 1000);
    await airdrop(connection, adminKeypair.publicKey, 1000);
    await airdrop(connection, folioOwnerKeypair.publicKey, 1000);

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
      await initToken(connection, adminKeypair, tokenMint);
      await mintToken(
        connection,
        adminKeypair,
        tokenMint.publicKey,
        1_000,
        folioOwnerKeypair.publicKey
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

  it.skip("should resize folio", async () => {
    const folioSizeBefore = (await connection.getAccountInfo(folioPDA))?.data
      .length;

    await resizeFolio(
      connection,
      folioOwnerKeypair,
      folioPDA,
      folioTokenMint.publicKey,
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

  it.skip("should update fee per second of folio", async () => {
    const folioBefore = await program.account.folio.fetch(folioPDA);

    await updateFolio(
      connection,
      folioOwnerKeypair,
      folioPDA,
      folioTokenMint.publicKey,
      null,
      null,
      folioBefore.feePerSecond.add(new BN(1)),
      [],
      []
    );

    const folioAfter = await program.account.folio.fetch(folioPDA);

    assert.deepEqual(folioAfter.programVersion, folioBefore.programVersion);
    assert.equal(
      folioAfter.programDeploymentSlot.toNumber(),
      folioBefore.programDeploymentSlot.toNumber()
    );
    assert.equal(
      folioAfter.feePerSecond.toNumber(),
      folioBefore.feePerSecond.add(new BN(1)).toNumber()
    );
    assert.deepEqual(folioAfter.feeRecipients, folioBefore.feeRecipients);

    // Resetting
    await updateFolio(
      connection,
      folioOwnerKeypair,
      folioPDA,
      folioTokenMint.publicKey,
      null,
      null,
      folioBefore.feePerSecond,
      [],
      []
    );
  });

  it.skip("should update fee recipients of folio", async () => {
    const folioBefore = await program.account.folio.fetch(folioPDA);

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
      folioTokenMint.publicKey,
      null,
      null,
      null,
      newFeeRecipient,
      []
    );

    let folioAfter = await program.account.folio.fetch(folioPDA);

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
      folioAfter.feeRecipients[0].receiver,
      newFeeRecipient[0].receiver
    );
    assert.deepEqual(
      folioAfter.feeRecipients[1].receiver,
      newFeeRecipient[1].receiver
    );
    assert.deepEqual(
      folioAfter.feeRecipients.slice(2),
      folioBefore.feeRecipients.slice(2)
    );
  });

  it.skip("should add trade approver", async () => {
    await addOrUpdateActor(
      connection,
      folioOwnerKeypair,
      folioPDA,
      folioTokenMint.publicKey,
      tradeApproverKeypair.publicKey,
      {
        tradeApprover: {},
      }
    );

    const actor = await programDtf.account.actor.fetch(
      getActorPDA(tradeApproverKeypair.publicKey, folioPDA)
    );

    assert.deepEqual(actor.roles, 2); //  binary 10 = 2 for trade approver
    assert.deepEqual(actor.authority, tradeApproverKeypair.publicKey);
    assert.deepEqual(actor.folio, folioPDA);
    assert.notEqual(actor.bump, 0);
  });

  it.skip("should update trade approver to also have price curator role", async () => {
    await addOrUpdateActor(
      connection,
      folioOwnerKeypair,
      folioPDA,
      folioTokenMint.publicKey,
      tradeApproverKeypair.publicKey,
      {
        priceCurator: {},
      }
    );

    const actor = await programDtf.account.actor.fetch(
      getActorPDA(tradeApproverKeypair.publicKey, folioPDA)
    );

    assert.deepEqual(actor.roles, 6); //  binary 110 = 6 for trade approver and price curator
    assert.deepEqual(actor.authority, tradeApproverKeypair.publicKey);
    assert.deepEqual(actor.folio, folioPDA);
    assert.notEqual(actor.bump, 0);
  });

  it.skip("should remove trade approver", async () => {
    await removeActor(
      connection,
      folioOwnerKeypair,
      folioPDA,
      folioTokenMint.publicKey,
      tradeApproverKeypair.publicKey,
      {
        tradeApprover: {},
      },
      true
    );

    await wait(2);

    const actor = await programDtf.account.actor.fetchNullable(
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

    const actorPostReinit = await programDtf.account.actor.fetchNullable(
      getActorPDA(tradeApproverKeypair.publicKey, folioPDA)
    );

    assert.equal(actorPostReinit, null);
  });

  it.skip("should add a token to the folio", async () => {
    const folioATA = await getOrCreateAtaAddress(
      connection,
      tokenMints[0].publicKey,
      folioOwnerKeypair,
      folioPDA
    );

    const folioBalanceBefore = await getTokenBalance(
      connection,
      folioATA,
      false
    );

    await addTokensToFolio(
      connection,
      folioOwnerKeypair,
      folioPDA,
      folioTokenMint.publicKey,
      [
        {
          mint: tokenMints[0].publicKey,
          amount: new BN(50 * 10 ** DEFAULT_DECIMALS),
        },
      ]
    );

    const folioBalanceAfter = await getTokenBalance(
      connection,
      folioATA,
      false
    );

    assert.equal(folioBalanceAfter, folioBalanceBefore + 50);
  });

  it.skip("should add another two tokens to the folio", async () => {
    const folioATA1 = await getOrCreateAtaAddress(
      connection,
      tokenMints[1].publicKey,
      folioOwnerKeypair,
      folioPDA
    );
    const folioATA2 = await getOrCreateAtaAddress(
      connection,
      tokenMints[2].publicKey,
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
      folioTokenMint.publicKey,
      [
        {
          mint: tokenMints[1].publicKey,
          amount: new BN(20 * 10 ** DEFAULT_DECIMALS),
        },
        {
          mint: tokenMints[2].publicKey,
          amount: new BN(90 * 10 ** DEFAULT_DECIMALS),
        },
      ]
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

    assert.equal(folioBalanceAfter1, folioBalanceBefore1 + 20);
    assert.equal(folioBalanceAfter2, folioBalanceBefore2 + 90);
  });

  it.skip("should finalize the folio", async () => {
    await finalizeFolio(
      connection,
      folioOwnerKeypair,
      folioPDA,
      folioTokenMint.publicKey
    );

    const folioAfter = await program.account.folio.fetch(folioPDA);

    assert.equal(folioAfter.status, 1);
  });

  /*
  Temporary tests for max token accounts
  */
  it("should mint folio token", async () => {
    // Works till 22
    let testsCases = [10, 15, 20, 21, 22, 23, 24, 25];

    let userKeypair = Keypair.generate();
    await airdrop(connection, userKeypair.publicKey, 1000);

    for (const testCase of testsCases) {
      let folioTokenMints = [];

      // Create a new for that number of tokens
      ({ folioTokenMint, folioPDA } = await initFolio(
        connection,
        folioOwnerKeypair,
        new BN(100)
      ));

      // Create the tokens that can be included in the folio
      for (let i = 0; i < testCase; i++) {
        let newTokenMint = Keypair.generate();
        folioTokenMints.push(newTokenMint);

        await initToken(connection, adminKeypair, newTokenMint);

        // Creating the token accounts for the folio and giving it some tokens
        await mintToken(
          connection,
          adminKeypair,
          newTokenMint.publicKey,
          10,
          folioPDA
        );
      }

      await mintFolioToken(
        connection,
        userKeypair,
        folioPDA,
        folioTokenMint.publicKey,
        folioTokenMints.map((tokenMint) => tokenMint.publicKey)
      );

      console.log("Passed with ", testCase);
    }
  });

  it("should mint folio token with LUT", async () => {
    // Works till 30
    let testsCases = [20, 25, 30, 35, 40, 45];

    let userKeypair = Keypair.generate();
    await airdrop(connection, userKeypair.publicKey, 1000);

    for (const testCase of testsCases) {
      let folioTokenMints = [];

      // Create a new for that number of tokens
      ({ folioTokenMint, folioPDA } = await initFolio(
        connection,
        folioOwnerKeypair,
        new BN(100)
      ));

      // Create the tokens that can be included in the folio
      for (let i = 0; i < testCase; i++) {
        let newTokenMint = Keypair.generate();
        folioTokenMints.push(newTokenMint);

        await initToken(connection, adminKeypair, newTokenMint);

        // Creating the token accounts for the folio and giving it some tokens
        await mintToken(
          connection,
          adminKeypair,
          newTokenMint.publicKey,
          10,
          folioPDA
        );
      }

      // Create lookup table and put the folio token accounts in it
      const lookupTable = await initLUT(connection, adminKeypair);

      await extendLUT(
        connection,
        adminKeypair,
        lookupTable,
        folioTokenMints.map((tokenMint) =>
          getAtaAddress(connection, tokenMint.publicKey, folioPDA)
        )
      );

      const lookupTableAccount = (
        await connection.getAddressLookupTable(lookupTable)
      ).value;

      await mintFolioToken(
        connection,
        userKeypair,
        folioPDA,
        folioTokenMint.publicKey,
        folioTokenMints.map((tokenMint) => tokenMint.publicKey),
        lookupTableAccount
      );

      console.log("Passed with ", testCase);
    }
  });
});
