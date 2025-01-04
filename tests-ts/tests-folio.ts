import { airdrop, getConnectors } from "../utils/program-helper";
import { Folio } from "../target/types/folio";
import { BN, Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  initOrUpdateCommunity,
  initFolio,
  initFolioSigner,
  initProgramRegistrar,
  updateProgramRegistrar,
} from "../utils/folio-helper";
import * as assert from "assert";
import {
  DTF_PROGRAM_ID,
  getActorPDA,
  getCommunityPDA,
  getFolioFeeRecipientsPDA,
  getFolioSignerPDA,
  getProgramRegistrarPDA,
} from "../utils/pda-helper";

describe("Folio Tests", () => {
  let connection: Connection;
  let program: Program<Folio>;
  let keys: any;

  let payerKeypair: Keypair;
  let adminKeypair: Keypair;
  let userKeypair: Keypair = Keypair.generate();

  let folioOwnerKeypair: Keypair;
  let folioTokenMint: Keypair;
  let folioPDA: PublicKey;
  let randomProgramId: PublicKey = Keypair.generate().publicKey;
  let communityReceiver: PublicKey = Keypair.generate().publicKey;

  before(async () => {
    ({ connection, programFolio: program, keys } = await getConnectors());

    payerKeypair = Keypair.fromSecretKey(Uint8Array.from(keys.payer));
    adminKeypair = Keypair.fromSecretKey(Uint8Array.from(keys.admin));

    folioOwnerKeypair = Keypair.generate();

    await airdrop(connection, payerKeypair.publicKey, 1000);
    await airdrop(connection, adminKeypair.publicKey, 1000);
    await airdrop(connection, folioOwnerKeypair.publicKey, 1000);
    await airdrop(connection, userKeypair.publicKey, 1000);
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

    const feeRecipients = await program.account.feeRecipients.fetchNullable(
      getFolioFeeRecipientsPDA(folioPDA)
    );

    assert.notEqual(folio.bump, 0);
    assert.equal(folio.folioFee.toNumber(), 100);
    assert.deepEqual(folio.programVersion, DTF_PROGRAM_ID);
    assert.deepEqual(folio.folioTokenMint, folioTokenMint.publicKey);
    assert.equal(feeRecipients, null);

    const ownerActorPDA = getActorPDA(folioOwnerKeypair.publicKey, folioPDA);

    const ownerActor = await program.account.actor.fetch(ownerActorPDA);

    assert.notEqual(ownerActor.bump, 0);
    assert.deepEqual(ownerActor.authority, folioOwnerKeypair.publicKey);
  });
});
