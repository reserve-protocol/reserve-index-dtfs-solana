import { airdrop, getConnectors } from "../utils/program-helper";
import { FolioAdmin } from "../target/types/folio_admin";
import { BN, Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as assert from "assert";
import {
  getDAOFeeConfigPDA,
  getFolioFeeConfigPDA,
  getFolioPDA,
  getProgramRegistrarPDA,
} from "../utils/pda-helper";
import {
  initProgramRegistrar,
  setDaoFeeConfig,
  setFolioFeeConfig,
  updateProgramRegistrar,
} from "../utils/folio-admin-helper";

import {
  FEE_NUMERATOR,
  FOLIO_ADMIN_PROGRAM_ID,
  MAX_FEE_FLOOR,
} from "../utils/constants";
import { initToken } from "../utils/token-helper";

/**
 * Tests for the Folio Admin program.
 * These tests are designed to test the functionality of the Folio Admin program from
 * working with the program registrar to setting the fees.
 */

describe("Folio Admin Tests", () => {
  let connection: Connection;
  let programFolioAdmin: Program<FolioAdmin>;
  let keys: any;

  let payerKeypair: Keypair;
  let adminKeypair: Keypair;

  const randomProgramId: PublicKey = Keypair.generate().publicKey;

  const feeRecipient: PublicKey = Keypair.generate().publicKey;

  before(async () => {
    ({ connection, programFolioAdmin, keys } = await getConnectors());

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
      FEE_NUMERATOR,
      MAX_FEE_FLOOR
    );

    const daoFeeConfigPDA = getDAOFeeConfigPDA();

    const daoFeeConfig = await programFolioAdmin.account.daoFeeConfig.fetch(
      daoFeeConfigPDA
    );

    assert.notEqual(daoFeeConfig.bump, 0);
    assert.deepEqual(daoFeeConfig.feeRecipient, feeRecipient);
    assert.deepEqual(daoFeeConfig.defaultFeeNumerator.eq(FEE_NUMERATOR), true);
  });

  it("should set the folio fee config", async () => {
    const folioTokenMint = Keypair.generate();
    await initToken(connection, adminKeypair, folioTokenMint);

    await setFolioFeeConfig(
      connection,
      adminKeypair,
      getFolioPDA(folioTokenMint.publicKey),
      folioTokenMint.publicKey,
      FEE_NUMERATOR.sub(new BN(1)),
      MAX_FEE_FLOOR.sub(new BN(1)),
      feeRecipient
    );

    const folioFeeConfigPDA = getFolioFeeConfigPDA(
      getFolioPDA(folioTokenMint.publicKey)
    );

    const folioFeeConfig = await programFolioAdmin.account.folioFeeConfig.fetch(
      folioFeeConfigPDA
    );

    assert.notEqual(folioFeeConfig.bump, 0);
    assert.deepEqual(
      folioFeeConfig.feeNumerator.eq(FEE_NUMERATOR.sub(new BN(1))),
      true
    );
    assert.deepEqual(
      folioFeeConfig.feeFloor.eq(MAX_FEE_FLOOR.sub(new BN(1))),
      true
    );
  });

  it("should initialize program registrar", async () => {
    await initProgramRegistrar(
      connection,
      adminKeypair,
      FOLIO_ADMIN_PROGRAM_ID
    );

    const programRegistrarPDA = getProgramRegistrarPDA();

    const programRegistrar =
      await programFolioAdmin.account.programRegistrar.fetch(
        programRegistrarPDA
      );

    assert.notEqual(programRegistrar.bump, 0);
    assert.deepEqual(
      programRegistrar.acceptedPrograms[0],
      FOLIO_ADMIN_PROGRAM_ID
    );
  });

  it("should update program registrar (add new program)", async () => {
    await updateProgramRegistrar(
      connection,
      adminKeypair,
      [randomProgramId],
      false
    );

    const programRegistrarPDA = getProgramRegistrarPDA();

    const programRegistrar =
      await programFolioAdmin.account.programRegistrar.fetch(
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

    const programRegistrar =
      await programFolioAdmin.account.programRegistrar.fetch(
        programRegistrarPDA
      );

    assert.deepEqual(programRegistrar.acceptedPrograms[1], PublicKey.default);
  });
});
