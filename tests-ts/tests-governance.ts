import { BN, Program } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { Dtfs } from "../target/types/dtfs";
import { airdrop, getConnectors, wait } from "../utils/program-helper";
import {
  getTokenBalance,
  initToken,
  mintToken,
  transferToken,
} from "../utils/token-helper";
import * as assert from "assert";
import { GovernanceAccount, RealmV2 } from "governance-idl-sdk";
import {
  addInstructionsToProposal,
  castVote,
  createGovernanceAccount,
  createProposal,
  createRealm,
  depositGoverningTokens,
  executeTransaction,
  signOffProposal,
} from "../utils/external/governance-helper";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

describe("DAO / Realm Tests", () => {
  let connection: Connection;
  let program: Program<Dtfs>;
  let keys: any;

  let payerKeypair: Keypair;
  let adminKeypair: Keypair;
  let ownerKeypair: Keypair;

  let mintToTransfer: Keypair;

  let otherMemberKeypair: Keypair;

  let communityTokenMint: Keypair;

  let realm: RealmV2;
  let governanceAccounts: GovernanceAccount[];
  let treasury: PublicKey;

  let proposalAccount: PublicKey;
  let proposalTransactionAccount: PublicKey;
  before(async () => {
    ({ connection, programDtf: program, keys } = await getConnectors());

    payerKeypair = Keypair.fromSecretKey(Uint8Array.from(keys.payer));
    adminKeypair = Keypair.fromSecretKey(Uint8Array.from(keys.admin));

    ownerKeypair = Keypair.generate();
    otherMemberKeypair = Keypair.generate();

    await airdrop(connection, payerKeypair.publicKey, 1000);
    await airdrop(connection, adminKeypair.publicKey, 1000);
    await airdrop(connection, ownerKeypair.publicKey, 1000);
    await airdrop(connection, otherMemberKeypair.publicKey, 1000);

    communityTokenMint = Keypair.generate();
    await initToken(connection, adminKeypair, communityTokenMint, 9);

    mintToTransfer = Keypair.generate();
    await initToken(connection, adminKeypair, mintToTransfer, 9);
  });

  it("Should create a Realm & Governance multisig", async () => {
    await mintToken(
      connection,
      adminKeypair,
      communityTokenMint.publicKey,
      205,
      ownerKeypair.publicKey
    );

    realm = await createRealm(
      connection,
      communityTokenMint.publicKey,
      new BN(1),
      ownerKeypair,
      "Test Realm Reserve",
      250
    );

    ({ governanceAccounts, treasury } = await createGovernanceAccount(
      connection,
      realm.publicKey,
      ownerKeypair
    ));

    // Deposit governing tokens for owner keypair (creator
    await depositGoverningTokens(
      connection,
      ownerKeypair,
      realm.publicKey,
      communityTokenMint.publicKey,
      new BN(200)
    );

    // Give tokens and SOL to the treasury so it can transfer later
    await mintToken(
      connection,
      adminKeypair,
      mintToTransfer.publicKey,
      100,
      treasury
    );

    await airdrop(connection, treasury, 100);
  });

  it("Should add a member to the DAO (another user deposits community tokens)", async () => {
    await mintToken(
      connection,
      adminKeypair,
      communityTokenMint.publicKey,
      50,
      otherMemberKeypair.publicKey
    );

    await depositGoverningTokens(
      connection,
      otherMemberKeypair,
      realm.publicKey,
      communityTokenMint.publicKey,
      new BN(50)
    );
  });

  it("Should transfer sol from the multisig to the admin as well as 1 spl token", async () => {
    const nativeBalanceAdminBefore = await getTokenBalance(
      connection,
      adminKeypair.publicKey,
      true
    );

    let transferMintIx = await transferToken(
      connection,
      adminKeypair,
      treasury,
      mintToTransfer.publicKey,
      20,
      adminKeypair.publicKey
    );

    // First create the proposal
    ({ proposalAccount } = await createProposal(
      connection,
      ownerKeypair,
      realm.publicKey,
      governanceAccounts[0].publicKey,
      communityTokenMint.publicKey,
      ownerKeypair.publicKey,
      "Test Proposal",
      "Test Description",
      ["Option 1"]
    ));

    // Add instructions to the proposal
    proposalTransactionAccount = await addInstructionsToProposal(
      connection,
      ownerKeypair,
      realm.publicKey,
      communityTokenMint.publicKey,
      governanceAccounts[0].publicKey,
      ownerKeypair.publicKey,
      proposalAccount,
      [
        SystemProgram.transfer({
          fromPubkey: treasury,
          toPubkey: adminKeypair.publicKey,
          lamports: 1 * LAMPORTS_PER_SOL,
        }),
        transferMintIx.instruction,
      ]
    );

    // Signoff the proposal
    await signOffProposal(
      connection,
      ownerKeypair,
      realm.publicKey,
      governanceAccounts[0].publicKey,
      proposalAccount,
      ownerKeypair.publicKey,
      communityTokenMint.publicKey
    );

    // Then both members vote
    await castVote(
      connection,
      ownerKeypair,
      realm.publicKey,
      governanceAccounts[0].publicKey,
      ownerKeypair.publicKey,
      communityTokenMint.publicKey,
      proposalAccount,
      ownerKeypair.publicKey,
      { approve: [[{ rank: 0, weightPercentage: 100 }]] }
    );

    /* 
    Normally would run this, but for simplicity we're doing very basic voting, don't need to have all the voters
    */
    // await castVote(
    //   connection,
    //   otherMemberKeypair,
    //   realm.publicKey,
    //   governanceAccounts[0].publicKey,
    //   otherMemberKeypair.publicKey,
    //   communityTokenMint.publicKey,
    //   proposalAccount,
    //   ownerKeypair.publicKey,
    //   { approve: [[{ rank: 0, weightPercentage: 100 }]] }
    // );

    await wait(5);

    /* 
    Finalize the vote & execute the transaction

    Normally would run this, but for simplicity we're doing very basic voting
    */

    // await finalizeVote(
    //   connection,
    //   ownerKeypair,
    //   realm.publicKey,
    //   governanceAccounts[0].publicKey,
    //   proposalAccount,
    //   ownerKeypair.publicKey,
    //   communityTokenMint.publicKey
    // );

    await executeTransaction(
      connection,
      ownerKeypair,
      governanceAccounts[0].publicKey,
      proposalAccount,
      proposalTransactionAccount,
      [
        { pubkey: treasury, isSigner: false, isWritable: true },
        { pubkey: adminKeypair.publicKey, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: transferMintIx.senderAta, isSigner: false, isWritable: true },
        {
          pubkey: transferMintIx.receiverAta,
          isSigner: false,
          isWritable: true,
        },
        {
          pubkey: mintToTransfer.publicKey,
          isSigner: false,
          isWritable: false,
        },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ]
    );

    const nativeBalanceAdminAfter = await getTokenBalance(
      connection,
      adminKeypair.publicKey,
      true
    );

    const adminBalanceMint = await getTokenBalance(
      connection,
      transferMintIx.receiverAta
    );

    assert.equal(adminBalanceMint, 20);
    assert.equal(
      nativeBalanceAdminAfter >= nativeBalanceAdminBefore + 1 - 0.00001, // 0.00001 is the fee (rent, txn fee, etc)
      true
    );
  });
});
