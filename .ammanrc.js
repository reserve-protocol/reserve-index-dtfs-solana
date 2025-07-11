// @ts-check
"use strict";
const { tmpLedgerDir } = require("@metaplex-foundation/amman");
const path = require("path");

const programsRemoteDeployDir = path.join(__dirname, "tests-ts/programs");
const localProgram = path.join(__dirname, "target/deploy");

const programs = [
  {
    label: "Token Metadata",
    programId: "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
    deployPath: path.join(programsRemoteDeployDir, `metadata.so`),
  },
  // Custom Implementation of SPL Governance
  {
    label: "SPL Governance",
    programId: "HwXcHGabc19PxzYFVSfKvuaDSNpbLGL8fhVtkcTyEymj",
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
    programId: "RsHWkAsrWvntjhWgMT1uBLJJea9TSjDhsx8j3DHVDEv",
    deployPath: path.join(localProgram, `folio_admin.so`),
  },
  {
    label: "Folio",
    programId: "DTF4yDGBkXJ25Ech1JVQpfwVb1vqYW4RJs5SuGNWdDev",
    deployPath: path.join(localProgram, `folio.so`),
  },
  {
    label: "Folio 2",
    programId: "n6sR7Eg5LMg5SGorxK9q3ZePHs9e8gjoQ7TgUW2YCaG",
    deployPath: path.join(localProgram, `second_folio.so`),
  },
  {
    label: "Rewards",
    programId: "7GiMvNDHVY8PXWQLHjSf1REGKpiDsVzRr4p7Y3xGbSuf",
    deployPath: path.join(localProgram, `rewards.so`),
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
