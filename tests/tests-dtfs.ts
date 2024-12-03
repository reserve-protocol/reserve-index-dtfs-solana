import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Connection } from "@solana/web3.js";
import { Dtfs } from "../target/types/dtfs";
import { getConnectors } from "../utils/program-helper";

describe("dtfs", () => {
  let connection: Connection;
  let program: Program<Dtfs>;
  let keys: any;

  before(async () => {
    ({ connection, program, keys } = await getConnectors());
  });
});
