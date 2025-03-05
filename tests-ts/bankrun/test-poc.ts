/**
 * @description This is a POC test setup using Bankrun for the Solana DTF program.
 */

import { Keypair } from "@solana/web3.js";
import { airdrop, getConnectors } from "./bankrun-program-helper";
import {
  createAndSetActor,
  createAndSetDaoFeeConfig,
  Role,
} from "./bankrun-account-helper";
import { createAndSetFolio } from "./bankrun-account-helper";
import { getFolioPDA, getGovernanceHoldingPDA } from "../../utils/pda-helper";
import {
  createGovernanceHoldingAccount,
  setupGovernanceAccounts,
} from "./bankrun-governance-helper";
import { D9, DEFAULT_DECIMALS, MAX_MINT_FEE } from "../../utils/constants";
import { BN } from "@coral-xyz/anchor";
import { initToken } from "./bankrun-token-helper";

/**
 * @description This is a test setup for the Solana DTF program without governance accounts (most of the time, it won't be used, as most
 * of the time, a governance should own the Folio).
 */
export async function setupTestNoGovernance() {
  const { keys, programFolio, programFolioAdmin, provider, context } =
    await getConnectors();

  const payerKeypair = provider.wallet.payer;

  const adminKeypair = Keypair.fromSecretKey(Uint8Array.from(keys.admin));

  const folioOwnerKeypair = Keypair.generate();
  const folioTokenMint = Keypair.generate();

  await airdrop(context, payerKeypair.publicKey, 1000);
  await airdrop(context, adminKeypair.publicKey, 1000);
  await airdrop(context, folioOwnerKeypair.publicKey, 1000);

  // Create default DAO fee config with max allowed mint fee
  await createAndSetDaoFeeConfig(
    context,
    programFolioAdmin,
    new Keypair().publicKey,
    MAX_MINT_FEE
  );

  // Create the Folio (extra default parameters can be set)
  await createAndSetFolio(context, programFolio, folioTokenMint.publicKey);

  const folioPDA = getFolioPDA(folioTokenMint.publicKey);

  // Init the folio token (if the folio is initialized via the actual instruction, this is not needed)
  initToken(
    context,
    folioPDA,
    folioTokenMint,
    DEFAULT_DECIMALS,
    new BN(1000000000)
  );

  // Set the Folio owner as the owner via the Actor account
  await createAndSetActor(
    context,
    programFolio,
    folioOwnerKeypair,
    folioPDA,
    Role.Owner
  );
}

/**
 * @description This is a test setup for the Solana DTF program with governance accounts, which will be the most used case.
 */
export async function setupTestWithGovernance() {
  const { keys, programFolio, provider, programFolioAdmin, context } =
    await getConnectors();

  const payerKeypair = provider.wallet.payer;

  const adminKeypair = Keypair.fromSecretKey(Uint8Array.from(keys.admin));

  const folioTokenMint = Keypair.generate();
  const governanceCommunityTokenMint = Keypair.generate();

  await airdrop(context, payerKeypair.publicKey, 1000);
  await airdrop(context, adminKeypair.publicKey, 1000);

  // Governance related accounts
  const { folioOwnerPDA, realmPDA } = await setupGovernanceAccounts(
    context,
    adminKeypair,
    governanceCommunityTokenMint.publicKey
  );

  // Init the governance token
  initToken(
    context,
    // We don't care about who owns it
    folioOwnerPDA,
    governanceCommunityTokenMint.publicKey,
    DEFAULT_DECIMALS,
    new BN(0)
  );

  // Creates the governing holding account (representing how much is staked total in the Realm)
  createGovernanceHoldingAccount(
    context,
    realmPDA,
    governanceCommunityTokenMint.publicKey,
    getGovernanceHoldingPDA(realmPDA, governanceCommunityTokenMint.publicKey),
    // As if there's already 200 staked by some other user
    new BN(200).mul(D9)
  );

  // Create default DAO fee config with max allowed mint fee
  await createAndSetDaoFeeConfig(
    context,
    programFolioAdmin,
    new Keypair().publicKey,
    MAX_MINT_FEE
  );

  // Create the Folio (extra default parameters can be set)
  await createAndSetFolio(context, programFolio, folioTokenMint.publicKey);

  const folioPDA = getFolioPDA(folioTokenMint.publicKey);

  // Init the folio token (if the folio is initialized via the actual instruction, this is not needed)
  initToken(
    context,
    folioPDA,
    folioTokenMint,
    DEFAULT_DECIMALS,
    new BN(1000000000)
  );

  // Set the Folio owner as the owner via the Actor account (which is a governance account)
  await createAndSetActor(
    context,
    programFolio,
    folioOwnerPDA,
    folioPDA,
    Role.Owner
  );

  // For the instructions that need to be executed from the Realm / Governance accounts, you can use the following helper functions:
  // - executeGovernanceInstruction (more examples in tests-staking-admin.ts)
}
