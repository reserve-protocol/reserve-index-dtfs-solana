import { airdrop, getConnectors } from "../utils/program-helper";
import { Dtfs } from "../target/types/dtfs";
import { BN, Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as assert from "assert";
import {
  getDAOFeeConfigPDA,
  getProgramRegistrarPDA,
} from "../utils/pda-helper";
import {
  initProgramRegistrar,
  setDaoFeeConfig,
  updateProgramRegistrar,
} from "../utils/dtf-helper";

import { DTF_PROGRAM_ID } from "../utils/constants";

describe("DTFs Tests", () => {
  let connection: Connection;
  let programDtf: Program<Dtfs>;
  let keys: any;

  let payerKeypair: Keypair;
  let adminKeypair: Keypair;

  const randomProgramId: PublicKey = Keypair.generate().publicKey;

  const feeRecipient: PublicKey = Keypair.generate().publicKey;
  const feeRecipientNumerator: BN = new BN("500000000000000000"); //50% in D18

  before(async () => {
    ({ connection, programDtf, keys } = await getConnectors());

    payerKeypair = Keypair.fromSecretKey(Uint8Array.from(keys.payer));
    adminKeypair = Keypair.fromSecretKey(Uint8Array.from(keys.admin));

    await airdrop(connection, payerKeypair.publicKey, 1000);
    await airdrop(connection, adminKeypair.publicKey, 1000);
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
      daoFeeConfig.feeRecipientNumerator.eq(feeRecipientNumerator),
      true
    );
  });

  it("should initialize program registrar", async () => {
    await initProgramRegistrar(connection, adminKeypair, DTF_PROGRAM_ID);

    const programRegistrarPDA = getProgramRegistrarPDA();

    const programRegistrar = await programDtf.account.programRegistrar.fetch(
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

    const programRegistrar = await programDtf.account.programRegistrar.fetch(
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

    const programRegistrar = await programDtf.account.programRegistrar.fetch(
      programRegistrarPDA
    );

    assert.deepEqual(programRegistrar.acceptedPrograms[1], PublicKey.default);
  });
});
