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
  initOrUpdateCommunity,
  initFolio,
  initFolioSigner,
  initProgramRegistrar,
  updateProgramRegistrar,
  initOrAddMintFolioToken,
  mintFolioToken,
  removeFromMintFolioToken,
} from "../utils/folio-helper";
import * as assert from "assert";
import {
  DTF_PROGRAM_ID,
  getActorPDA,
  getCommunityPDA,
  getFolioFeeRecipientsPDA,
  getFolioPendingTokenAmountsPDA,
  getFolioSignerPDA,
  getProgramRegistrarPDA,
  getUserPendingTokenAmountsPDA,
} from "../utils/pda-helper";
import {
  DEFAULT_DECIMALS_MUL,
  getOrCreateAtaAddress,
  getTokenBalance,
  initToken,
  mintToken,
} from "../utils/token-helper";
import {
  addTokensToFolio,
  finalizeFolio,
  initDtfSigner,
} from "../utils/dtf-helper";
import { token } from "@coral-xyz/anchor/dist/cjs/utils";

describe("Folio Tests", () => {
  let connection: Connection;
  let program: Program<Folio>;
  let programDtf: Program<Dtfs>;
  let keys: any;

  let payerKeypair: Keypair;
  let adminKeypair: Keypair;
  let userKeypair: Keypair = Keypair.generate();

  let folioOwnerKeypair: Keypair;
  let folioTokenMint: Keypair;
  let folioPDA: PublicKey;
  let randomProgramId: PublicKey = Keypair.generate().publicKey;
  let communityReceiver: PublicKey = Keypair.generate().publicKey;

  let tokenMints: Keypair[] = Array.from({ length: 5 }, () =>
    Keypair.generate()
  );

  async function initFolioData(tokenMints: Keypair[], folioPDA: PublicKey) {
    for (const token of tokenMints) {
      await getOrCreateAtaAddress(
        connection,
        token.publicKey,
        folioOwnerKeypair,
        folioPDA
      );
    }

    await initDtfSigner(connection, adminKeypair);

    await addTokensToFolio(
      connection,
      folioOwnerKeypair,
      folioPDA,
      folioTokenMint.publicKey,
      tokenMints.map((token) => ({
        mint: token.publicKey,
        amount: new BN(0),
      }))
    );

    await finalizeFolio(
      connection,
      folioOwnerKeypair,
      folioPDA,
      folioTokenMint.publicKey
    );
  }

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

    await airdrop(connection, payerKeypair.publicKey, 1000);
    await airdrop(connection, adminKeypair.publicKey, 1000);
    await airdrop(connection, folioOwnerKeypair.publicKey, 1000);
    await airdrop(connection, userKeypair.publicKey, 1000);

    // Mint and give tokens to user
    for (const tokenMint of tokenMints) {
      await initToken(connection, adminKeypair, tokenMint);
      await mintToken(
        connection,
        adminKeypair,
        tokenMint.publicKey,
        1_000,
        userKeypair.publicKey
      );
    }
  });

  it("should initialize a folio signer", async () => {
    await initFolioSigner(connection, payerKeypair);

    const folioSignerPDA = getFolioSignerPDA();

    const folioSigner = await program.account.folioProgramSigner.fetch(
      folioSignerPDA
    );

    assert.notEqual(folioSigner.bump, 0);
  });

  it("should initialize a community", async () => {
    await initOrUpdateCommunity(connection, adminKeypair, communityReceiver);

    const communityPDA = getCommunityPDA();

    const community = await program.account.community.fetch(communityPDA);

    assert.notEqual(community.bump, 0);
    assert.deepEqual(community.communityReceiver, communityReceiver);
  });

  it("should initialize program registrar", async () => {
    await initProgramRegistrar(connection, adminKeypair, DTF_PROGRAM_ID);

    const programRegistrarPDA = getProgramRegistrarPDA();

    const programRegistrar = await program.account.programRegistrar.fetch(
      programRegistrarPDA
    );

    assert.notEqual(programRegistrar.bump, 0);
    assert.deepEqual(programRegistrar.acceptedPrograms[0], DTF_PROGRAM_ID);
  });

  it("should update program registrar (add new program)", async () => {
    await updateProgramRegistrar(
      connection,
      adminKeypair,
      [randomProgramId],
      false
    );

    const programRegistrarPDA = getProgramRegistrarPDA();

    const programRegistrar = await program.account.programRegistrar.fetch(
      programRegistrarPDA
    );

    assert.deepEqual(programRegistrar.acceptedPrograms[1], randomProgramId);
  });

  it("should update program registrar (remove program)", async () => {
    await updateProgramRegistrar(
      connection,
      adminKeypair,
      [randomProgramId],
      true
    );

    const programRegistrarPDA = getProgramRegistrarPDA();

    const programRegistrar = await program.account.programRegistrar.fetch(
      programRegistrarPDA
    );

    assert.deepEqual(programRegistrar.acceptedPrograms[1], PublicKey.default);
  });

  it("should initialize a folio", async () => {
    ({ folioTokenMint, folioPDA } = await initFolio(
      connection,
      folioOwnerKeypair,
      new BN(100)
    ));

    const folio = await program.account.folio.fetch(folioPDA);

    const feeRecipients =
      await program.account.folioFeeRecipients.fetchNullable(
        getFolioFeeRecipientsPDA(folioPDA)
      );

    assert.notEqual(folio.bump, 0);
    assert.equal(folio.feePerSecond.toNumber(), 100);
    assert.deepEqual(folio.programVersion, DTF_PROGRAM_ID);
    assert.deepEqual(folio.folioTokenMint, folioTokenMint.publicKey);
    assert.equal(feeRecipients, null);

    const ownerActorPDA = getActorPDA(folioOwnerKeypair.publicKey, folioPDA);

    const ownerActor = await programDtf.account.actor.fetch(ownerActorPDA);

    assert.notEqual(ownerActor.bump, 0);
    assert.deepEqual(ownerActor.authority, folioOwnerKeypair.publicKey);
  });

  it("should allow user to init mint folio tokens", async () => {
    await initFolioData(tokenMints, folioPDA);

    await initOrAddMintFolioToken(connection, userKeypair, folioPDA, [
      { mint: tokenMints[0].publicKey, amount: new BN(100) },
    ]);

    const userPendingTokenAmountsPDA = getUserPendingTokenAmountsPDA(
      userKeypair.publicKey
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
      100
    );

    assert.equal(
      folioPendingTokenAmounts.tokenAmounts[0].amount.toNumber(),
      100
    );
  });

  it("should allow user to add to mint folio tokens", async () => {
    const userPendingTokenAmountsPDA = getUserPendingTokenAmountsPDA(
      userKeypair.publicKey
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
      { mint: tokenMints[1].publicKey, amount: new BN(100) },
      { mint: tokenMints[2].publicKey, amount: new BN(200) },
      { mint: tokenMints[3].publicKey, amount: new BN(300) },
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
      userPendingTokenAmountsBefore.tokenAmounts[1].amount.toNumber() + 100
    );

    assert.equal(
      folioPendingTokenAmountsAfter.tokenAmounts[1].amount.toNumber(),
      folioPendingTokenAmountsBefore.tokenAmounts[1].amount.toNumber() + 100
    );

    assert.equal(
      userPendingTokenAmountsAfter.tokenAmounts[2].amount.toNumber(),
      userPendingTokenAmountsBefore.tokenAmounts[2].amount.toNumber() + 200
    );

    assert.equal(
      folioPendingTokenAmountsAfter.tokenAmounts[2].amount.toNumber(),
      folioPendingTokenAmountsBefore.tokenAmounts[2].amount.toNumber() + 200
    );

    assert.equal(
      userPendingTokenAmountsAfter.tokenAmounts[3].amount.toNumber(),
      userPendingTokenAmountsBefore.tokenAmounts[3].amount.toNumber() + 300
    );
    assert.equal(
      folioPendingTokenAmountsAfter.tokenAmounts[3].amount.toNumber(),
      folioPendingTokenAmountsBefore.tokenAmounts[3].amount.toNumber() + 300
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
      userKeypair.publicKey
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
            mint: token.publicKey,
            amount: new BN(0),
          })),
          new BN(100)
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
      userKeypair.publicKey
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
      { mint: tokenMints[3].publicKey, amount: new BN(100) },
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
      userPendingTokenAmountsBefore.tokenAmounts[3].amount.toNumber() - 100
    );

    assert.equal(
      folioPendingTokenAmountsAfter.tokenAmounts[3].amount.toNumber(),
      folioPendingTokenAmountsBefore.tokenAmounts[3].amount.toNumber() - 100
    );
  });

  it("should allow user to mint folio token (after adding 5th token)", async () => {
    await initOrAddMintFolioToken(connection, userKeypair, folioPDA, [
      { mint: tokenMints[4].publicKey, amount: new BN(100) },
    ]);

    const userFolioMintATA = await getOrCreateAtaAddress(
      connection,
      folioTokenMint.publicKey,
      userKeypair,
      userKeypair.publicKey
    );

    const userPendingTokenAmountsPDA = getUserPendingTokenAmountsPDA(
      userKeypair.publicKey
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

    await mintFolioToken(
      connection,
      userKeypair,
      folioPDA,
      folioTokenMint.publicKey,
      tokenMints.map((token) => ({
        mint: token.publicKey,
        amount: new BN(0),
      })),
      new BN(100)
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

    assert.equal(
      userFolioTokenBalanceAfter,
      userFolioTokenBalanceBefore + 100 / DEFAULT_DECIMALS_MUL
    );

    for (let i = 0; i < tokenMints.length; i++) {
      assert.equal(
        userPendingTokenAmountsAfter.tokenAmounts[i].amount.toNumber(),
        userPendingTokenAmountsBefore.tokenAmounts[i].amount.toNumber() - 100
      );

      assert.equal(
        folioPendingTokenAmountsAfter.tokenAmounts[i].amount.toNumber(),
        folioPendingTokenAmountsBefore.tokenAmounts[i].amount.toNumber() - 100
      );
    }
  });
});
