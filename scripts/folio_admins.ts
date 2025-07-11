// This script contains transactions to initialize folio admin program.
// This script is only needed for dev environment, for production we can use squards/other multisig interface.
// Can we called:
//
// Run by using: ANCHOR_WALLET=$HOME/.config/solana/id.json ANCHOR_PROVIDER_URL=rpc npx ts-node --project scripts/tsconfig.scripts.json scripts/folio_admins.ts
import { FolioAdmin } from "../target/types/folio_admin";
import IDL from "../target/idl/folio_admin.json";

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

const setUp = () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const idl = IDL as FolioAdmin;
  const program = new Program<FolioAdmin>(idl, anchor.getProvider());
  return program;
};

const folioProgramId = new PublicKey(
  "DTF4yDGBkXJ25Ech1JVQpfwVb1vqYW4RJs5SuGNWdDev"
);
// @ts-ignore
const initProgramRegistrar = async () => {
  // Initialize folio admin program, registrar program.
  const folioAdmin = setUp();
  const tx = await folioAdmin.methods
    .initProgramRegistrar(folioProgramId)
    .accounts({
      admin: folioAdmin.provider.publicKey,
    })
    .rpc();
  console.log(`Transaction hash: ${tx}`);
};

// initProgramRegistrar();

// @ts-ignore
const setDaoFeeConfig = async () => {
  // Initialize folio admin program, registrar program.
  const folioAdmin = setUp();
  const tx = await folioAdmin.methods
    .setDaoFeeConfig(
      folioAdmin.provider.publicKey,
      new anchor.BN("50000000000000000"), //  5%
      new anchor.BN("1500000000000000") // 0.15%
    )
    .accounts({
      admin: folioAdmin.provider.publicKey,
    })
    .rpc();
  console.log(`Transaction hash: ${tx}`);
};

setDaoFeeConfig();
