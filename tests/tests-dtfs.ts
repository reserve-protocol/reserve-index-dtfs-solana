import { Program } from "@coral-xyz/anchor";
import { Connection, Keypair } from "@solana/web3.js";
import { Dtfs } from "../target/types/dtfs";
import { getConnectors } from "../utils/program-helper";

describe("dtfs", () => {
  let connection: Connection;
  let program: Program<Dtfs>;
  let keys: any;

  let payerKeypair: Keypair;
  let adminKeypair: Keypair;

  before(async () => {
    ({ connection, programDtf: program, keys } = await getConnectors());

    payerKeypair = Keypair.fromSecretKey(Uint8Array.from(keys.payer));
    adminKeypair = Keypair.fromSecretKey(Uint8Array.from(keys.admin));
  });
});
