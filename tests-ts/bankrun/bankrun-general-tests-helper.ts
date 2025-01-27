import { Keypair, PublicKey } from "@solana/web3.js";
import { DTF_PROGRAM_ID } from "../../utils/pda-helper";

export function getNonAdminTestCase(getPayerKeypair: () => Keypair) {
  return {
    desc: "(not admin)",
    getKeypair: getPayerKeypair,
    expectedError: "Unauthorized",
  };
}

export function getInvalidDtfProgramTestCase(
  otherDeployedDtfProgram: PublicKey
) {
  return {
    desc: "(invalid dtf program id)",
    dtfProgramId: otherDeployedDtfProgram,
    expectedError: "InvalidProgramVersion",
  };
}

export function getInvalidDtfProgramDeploymentSlotTestCase() {
  return {
    desc: "(invalid dtf program deployment slot)",
    dtfProgramId: DTF_PROGRAM_ID,
    expectedError: "InvalidProgramVersion",
  };
}

export function getProgramNotInRegistrarTestCase() {
  return {
    desc: "(program not in registrar)",
    dtfProgramId: Keypair.generate().publicKey,
    expectedError: "ProgramNotInRegistrar",
  };
}
