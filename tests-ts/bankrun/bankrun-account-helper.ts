import { Keypair } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import { ProgramTestContext } from "solana-bankrun";
import {
  DTF_PROGRAM_ID,
  FOLIO_PROGRAM_ID,
  getDaoFeeConfigPDAWithBump,
  getProgramRegistrarPDAWithBump,
  SPL_GOVERNANCE_PROGRAM_ID,
} from "../../utils/pda-helper";
import { createFakeTokenOwnerRecordV2 } from "../../utils/data-helper";

import { Folio } from "../../target/types/folio";
import { BN, Program } from "@coral-xyz/anchor";
import { Dtfs } from "../../target/types/dtfs";

/*
External Accounts
*/
export function createGovernanceAccount(
  context: ProgramTestContext,
  userTokenRecordPda: PublicKey,
  depositAmount: number
) {
  const governanceAccountData = createFakeTokenOwnerRecordV2(
    depositAmount,
    Keypair.generate().publicKey,
    Keypair.generate().publicKey,
    Keypair.generate().publicKey,
    Keypair.generate().publicKey
  );

  context.setAccount(userTokenRecordPda, {
    lamports: 1_000_000_000,
    data: governanceAccountData,
    owner: SPL_GOVERNANCE_PROGRAM_ID,
    executable: false,
  });
}

/*
Folio Accounts
*/
export async function setFolioAccountInfo(
  ctx: ProgramTestContext,
  program: Program<Folio>,
  accountAddress: PublicKey,
  accountName: string,
  accountData: any
) {
  const encodedAccountData = await program.coder.accounts.encode(
    accountName,
    accountData
  );

  const accountInfo = {
    lamports: 1_000_000_000,
    data: encodedAccountData,
    owner: FOLIO_PROGRAM_ID,
    executable: false,
  };

  ctx.setAccount(accountAddress, accountInfo);
}

export async function createAndSetProgramRegistrar(
  ctx: ProgramTestContext,
  program: Program<Folio>,
  acceptedPrograms: PublicKey[]
) {
  const programRegistrarPDAWithBump = getProgramRegistrarPDAWithBump();

  const programRegistrar = {
    bump: programRegistrarPDAWithBump[1],
    acceptedPrograms: acceptedPrograms.concat(
      Array(10 - acceptedPrograms.length).fill(PublicKey.default)
    ),
  };

  await setFolioAccountInfo(
    ctx,
    program,
    programRegistrarPDAWithBump[0],
    "programRegistrar",
    programRegistrar
  );
}

/*
DTF Accounts
*/
export async function setDTFAccountInfo(
  ctx: ProgramTestContext,
  program: Program<Dtfs>,
  accountAddress: PublicKey,
  accountName: string,
  accountData: any
) {
  const encodedAccountData = await program.coder.accounts.encode(
    accountName,
    accountData
  );

  ctx.setAccount(accountAddress, {
    lamports: 1_000_000_000,
    data: encodedAccountData,
    owner: DTF_PROGRAM_ID,
    executable: false,
  });
}

export async function createAndSetDaoFeeConfig(
  ctx: ProgramTestContext,
  program: Program<Dtfs>,
  feeRecipient: PublicKey,
  feeNumerator: BN
) {
  const daoFeeConfigPDAWithBump = getDaoFeeConfigPDAWithBump();
  const daoFeeConfig = {
    bump: daoFeeConfigPDAWithBump[1],
    feeRecipient,
    feeNumerator,
  };

  await setDTFAccountInfo(
    ctx,
    program,
    daoFeeConfigPDAWithBump[0],
    "daoFeeConfig",
    daoFeeConfig
  );
}
