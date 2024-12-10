import { Program } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { Dtfs } from "../target/types/dtfs";
import { airdrop, getConnectors } from "../utils/program-helper";
import {
  createSquad,
  addMember,
  DEFAULT_AUTHORITY_INDEX,
  executeTransaction,
  approveTransaction,
  createGenericTransaction,
} from "../utils/external/squads-helper";
import { MultisigAccount } from "@sqds/sdk";
import {
  getTokenBalance,
  initToken,
  mintToken,
  transferToken,
} from "../utils/token-helper";
import * as assert from "assert";

describe("Multisig Tests", () => {
  let connection: Connection;
  let program: Program<Dtfs>;
  let keys: any;

  let payerKeypair: Keypair;
  let adminKeypair: Keypair;
  let ownerKeypair: Keypair;

  let mint1Keypair: Keypair;
  let mint2Keypair: Keypair;

  let otherMemberKeypair: Keypair;

  let multisigAccount: MultisigAccount;
  let multisigVault: PublicKey;

  before(async () => {
    ({ connection, program, keys } = await getConnectors());

    payerKeypair = Keypair.fromSecretKey(Uint8Array.from(keys.payer));
    adminKeypair = Keypair.fromSecretKey(Uint8Array.from(keys.admin));

    ownerKeypair = Keypair.generate();
    otherMemberKeypair = Keypair.generate();

    await airdrop(connection, payerKeypair.publicKey, 1000);
    await airdrop(connection, adminKeypair.publicKey, 1000);

    await airdrop(connection, ownerKeypair.publicKey, 1000);
    await airdrop(connection, otherMemberKeypair.publicKey, 1000);

    mint1Keypair = Keypair.generate();
    mint2Keypair = Keypair.generate();

    await initToken(connection, adminKeypair, mint1Keypair, 9);
    await initToken(connection, adminKeypair, mint2Keypair, 9);
  });

  it("Should create a Squads multisig", async () => {
    ({ multisigAccount, vault: multisigVault } = await createSquad(
      ownerKeypair
    ));

    await airdrop(connection, multisigVault, 1000);
    await airdrop(connection, multisigAccount.publicKey, 1000);

    await mintToken(
      connection,
      adminKeypair,
      mint1Keypair.publicKey,
      1000,
      multisigVault
    );
    await mintToken(
      connection,
      adminKeypair,
      mint2Keypair.publicKey,
      1000,
      multisigVault
    );
  });

  it("Should add a member to the multisig", async () => {
    const txnPda = await addMember(
      ownerKeypair,
      multisigAccount,
      otherMemberKeypair.publicKey,
      true
    );

    await approveTransaction(ownerKeypair, txnPda);

    await executeTransaction(ownerKeypair, txnPda);
  });

  it("Should transfer sol from the multisig to the admin as well as 2 spl tokens", async () => {
    const nativeBalanceAdminBefore = await getTokenBalance(
      connection,
      adminKeypair.publicKey,
      true
    );

    let transferMint1 = await transferToken(
      connection,
      adminKeypair,
      multisigVault,
      mint1Keypair.publicKey,
      10,
      adminKeypair.publicKey
    );
    let transferMint2 = await transferToken(
      connection,
      adminKeypair,
      multisigVault,
      mint2Keypair.publicKey,
      20,
      adminKeypair.publicKey
    );

    const txnPda = await createGenericTransaction(
      ownerKeypair,
      multisigAccount,
      DEFAULT_AUTHORITY_INDEX,
      [
        SystemProgram.transfer({
          fromPubkey: multisigVault,
          toPubkey: adminKeypair.publicKey,
          lamports: 1 * LAMPORTS_PER_SOL,
        }),
        transferMint1.instruction,
        transferMint2.instruction,
      ]
    );

    // 2 Approvals with new threshold
    await approveTransaction(ownerKeypair, txnPda);
    await approveTransaction(otherMemberKeypair, txnPda);

    await executeTransaction(otherMemberKeypair, txnPda);

    const nativeBalanceAdminAfter = await getTokenBalance(
      connection,
      adminKeypair.publicKey,
      true
    );
    const adminBalanceMint1 = await getTokenBalance(
      connection,
      transferMint1.receiverAta
    );
    const adminBalanceMint2 = await getTokenBalance(
      connection,
      transferMint2.receiverAta
    );

    assert.equal(adminBalanceMint1, 10);
    assert.equal(adminBalanceMint2, 20);
    assert.equal(
      nativeBalanceAdminAfter >= nativeBalanceAdminBefore + 1 - 0.00001, // 0.00001 is the fee (rent, txn fee, etc)
      true
    );
  });
});
