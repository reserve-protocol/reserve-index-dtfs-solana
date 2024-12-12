import * as anchor from "@coral-xyz/anchor";
import {
  Keypair,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { getConnectors } from "../utils/program-helper";

async function testIx() {
  const { programDtf: program, keys } = await getConnectors();

  const adminKeypair = Keypair.fromSecretKey(Uint8Array.from(keys.admin));

  const ix = new TransactionInstruction({
    keys: [],
    programId: program.programId,
  });

  try {
    await program.provider.sendAndConfirm(
      new Transaction().add(ix),
      [adminKeypair],
      { skipPreflight: true }
    );
  } catch (e) {
    console.log(e);
  }
}

testIx();
