// @ts-check
"use strict";
const { tmpLedgerDir } = require("@metaplex-foundation/amman");
const path = require("path");

const programsRemoteDeployDir = path.join(__dirname, "tests/programs");
const localProgram = path.join(__dirname, "target/deploy");

const programs = [
  {
    label: "Token Metadata",
    programId: "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
    deployPath: path.join(programsRemoteDeployDir, `metadata.so`),
  },
  {
    label: "SPL Governance",
    programId: "GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw",
    deployPath: path.join(programsRemoteDeployDir, `governance.so`),
  },
  {
    label: "Squads",
    programId: "SMPLecH534NA9acpos4G6x7uf3LWbCAwZQE9e8ZekMu",
    deployPath: path.join(programsRemoteDeployDir, `squads.so`),
  },
  // Our programs
  {
    label: "Folio Admin",
    programId: "7ZqvG9KKhzA3ykto2WMYuw3waWuaydKwYKHYSf7SiFbn",
    deployPath: path.join(localProgram, `folio_admin.so`),
  },
  {
    label: "Folio",
    programId: "n6sR7Eg5LMg5SGorxK9q3ZePHs9e8gjoQ7TgUW2YCaG",
    deployPath: path.join(localProgram, `folio.so`),
  },
  {
    label: "Folio 2",
    programId: "7ApLyZSzV9jHseZnSLmyHJjsbNWzd85DYx2qe8cSCLWt",
    deployPath: path.join(localProgram, `second_folio.so`),
  },
];

const validator = {
  killRunningValidators: true,
  verifyFees: false,
  commitment: "confirmed",
  programs,
  jsonRpcUrl: "http://127.0.0.1:8899/",
  websocketUrl: "",
  resetLedger: true,
  ledgerDir: tmpLedgerDir(),
  matchFeatures: "mainnet-beta",
  accountsCluster: "https://api.mainnet-beta.solana.com",
  accounts: [],
};

module.exports = {
  programs,
  validator,
  storage: {
    storageId: "js-next-sdk",
    clearOnStart: true,
  },
  relay: { enabled: true },
};
