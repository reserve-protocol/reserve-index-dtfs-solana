import * as anchor from "@coral-xyz/anchor";
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";
import { Connection, Keypair } from "@solana/web3.js";
import fs from "fs/promises";
import path from "path";
import { Dtfs } from "../target/types/dtfs";
import idl from "../target/idl/dtfs.json";

export async function getConnectors() {
  let rpcUrl = "";
  let keysFileName = "";
  let dtfsProgramId = "";

  switch (process.env.NODE_ENV) {
    case "devnet":
      dtfsProgramId = "";
      rpcUrl = "https://api.devnet.solana.com";
      keysFileName = "keys-devnet.json";
      break;
    default:
      dtfsProgramId = "";
      rpcUrl = "http://127.0.0.1:8899";
      keysFileName = "keys-local.json";
  }

  const connection = new Connection(rpcUrl, {
    commitment: "confirmed",
  });

  const keys = JSON.parse(
    (await fs.readFile(path.join(__dirname, "keys", keysFileName))).toString()
  );

  const payerKeypair = Keypair.fromSecretKey(Uint8Array.from(keys.payer));

  const anchorProvider = new anchor.AnchorProvider(
    connection,
    new NodeWallet(payerKeypair),
    anchor.AnchorProvider.defaultOptions()
  );

  anchor.setProvider(anchorProvider);

  return {
    connection,
    keys,
    program: new anchor.Program<Dtfs>(idl as Dtfs),
    anchorProvider,
  };
}

export async function wait(seconds = 2) {
  await new Promise((f) => setTimeout(f, seconds * 1_000));
}
