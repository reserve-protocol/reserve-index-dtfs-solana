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
    label: "DTFS",
    programId: "Cr1UEkStzJPQ4wa9Lr6ryJWci83baMvrQLT3skd1eLmG",
    deployPath: path.join(localProgram, `dtfs.so`),
  },
  {
    label: "FToken Manager",
    programId: "FESnpQMqnsixE1MU4xZMLiLQGErg7JdqjmtjgWsvQ55m",
    deployPath: path.join(localProgram, `folio.so`),
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
