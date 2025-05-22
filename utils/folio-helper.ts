import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
import { Folio } from "../target/types/folio";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import idlFolio from "../target/idl/folio.json";
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";
import {
  getComputeLimitInstruction,
  pSendAndConfirmTxn,
} from "./program-helper";
import {
  getActorPDA,
  getDAOFeeConfigPDA,
  getFeeDistributionPDA,
  getFolioBasketPDA,
  getTVLFeeRecipientsPDA,
  getFolioPDA,
  getMetadataPDA,
  getProgramRegistrarPDA,
  getUserPendingBasketPDA,
  getFolioFeeConfigPDA,
  getRebalancePDA,
  getAuctionEndsPDA,
} from "./pda-helper";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { TOKEN_METADATA_PROGRAM_ID } from "./constants";
import { getOrCreateAtaAddress } from "./token-helper";
import {
  buildRemainingAccounts,
  buildRemainingAccountsForMigrateFolioTokens,
} from "./remaining-accounts-helper";
import idlSecondFolio from "../target/idl/second_folio.json";
import { Folio as SecondFolio } from "../target/types/second_folio";

let folioProgram: Program<Folio> = null;
let secondFolioProgram: Program<SecondFolio> = null;

const SKIP_PREFLIGHT = true;

/**
 * Core helper functions for interacting with the Folio protocol. Includes methods
 * for initializing folios, managing baskets, handling auctions, fees, and
 * migrations. Primary interface for most Folio program operations.
 */

export function getFolioProgram(
  connection: Connection,
  wallet: Keypair
): Program<Folio> {
  if (!folioProgram || folioProgram.provider.publicKey != wallet.publicKey) {
    folioProgram = new Program<Folio>(
      idlFolio as Folio,
      new AnchorProvider(
        connection,
        new NodeWallet(wallet),
        AnchorProvider.defaultOptions()
      )
    );
  }

  return folioProgram;
}

// To be able to test migrations
export function getSecondFolioProgram(
  connection: Connection,
  wallet: Keypair
): Program<SecondFolio> {
  if (
    !secondFolioProgram ||
    secondFolioProgram.provider.publicKey != wallet.publicKey
  ) {
    secondFolioProgram = new Program<SecondFolio>(
      idlSecondFolio as SecondFolio,
      new AnchorProvider(
        connection,
        new NodeWallet(wallet),
        AnchorProvider.defaultOptions()
      )
    );
  }
  return secondFolioProgram;
}

export async function initFolio(
  connection: Connection,
  folioOwner: Keypair,
  folioTokenMint: Keypair,
  tvlFee: BN,
  mintFee: BN,
  auctionLength: BN,
  name: string,
  symbol: string,
  uri: string,
  mandate: string,
  useSecondFolioProgram: boolean = false
): Promise<PublicKey> {
  const folioProgram = useSecondFolioProgram
    ? getSecondFolioProgram(connection, folioOwner)
    : getFolioProgram(connection, folioOwner);

  const folioPDA = getFolioPDA(folioTokenMint.publicKey, useSecondFolioProgram);

  const initFolio = await folioProgram.methods
    .initFolio(tvlFee, mintFee, auctionLength, name, symbol, uri, mandate)
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      folioOwner: folioOwner.publicKey,
      folio: folioPDA,
      folioTokenMint: folioTokenMint.publicKey,
      actor: getActorPDA(folioOwner.publicKey, folioPDA, useSecondFolioProgram),
      tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
      metadata: getMetadataPDA(folioTokenMint.publicKey),
    })
    .instruction();

  await pSendAndConfirmTxn(folioProgram, [initFolio], [folioTokenMint], {
    skipPreflight: SKIP_PREFLIGHT,
  });

  return folioPDA;
}

export async function updateFolio(
  connection: Connection,
  folioOwnerKeypair: Keypair,
  folio: PublicKey,
  folioTokenMint: PublicKey,
  daoFeeRecipient: PublicKey,
  tvlFee: BN | null,
  indexForFeeDistribution: BN | null,
  mintFee: BN | null,
  auctionLength: BN | null,
  feeRecipientsToAdd: { recipient: PublicKey; portion: BN }[],
  feeRecipientsToRemove: PublicKey[],
  mandate: string | null
) {
  const folioProgram = getFolioProgram(connection, folioOwnerKeypair);

  const updateFolio = await folioProgram.methods
    .updateFolio(
      tvlFee,
      indexForFeeDistribution,
      mintFee,
      auctionLength,
      feeRecipientsToAdd,
      feeRecipientsToRemove,
      mandate
    )
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
      folioOwner: folioOwnerKeypair.publicKey,
      actor: getActorPDA(folioOwnerKeypair.publicKey, folio),
      folio: folio,
      feeRecipients: getTVLFeeRecipientsPDA(folio),
    })
    .remainingAccounts([
      {
        pubkey: TOKEN_PROGRAM_ID,
        isSigner: false,
        isWritable: false,
      },
      {
        pubkey: getDAOFeeConfigPDA(),
        isSigner: false,
        isWritable: false,
      },
      {
        pubkey: getFolioFeeConfigPDA(folio),
        isSigner: false,
        isWritable: false,
      },
      {
        pubkey: folioTokenMint,
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: getFeeDistributionPDA(folio, indexForFeeDistribution),
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: await getOrCreateAtaAddress(
          connection,
          folioTokenMint,
          folioOwnerKeypair,
          daoFeeRecipient
        ),
        isSigner: false,
        isWritable: true,
      },
    ])
    .instruction();

  await pSendAndConfirmTxn(
    folioProgram,
    [...getComputeLimitInstruction(600_000), updateFolio],
    [],
    {
      skipPreflight: SKIP_PREFLIGHT,
    }
  );
}

export async function addOrUpdateActor(
  connection: Connection,
  folioOwnerKeypair: Keypair,
  folio: PublicKey,
  newActorAuthority: PublicKey,
  role: any = { priceCurator: {} }
) {
  const folioProgram = getFolioProgram(connection, folioOwnerKeypair);

  const addOrUpdateActor = await folioProgram.methods
    .initOrUpdateActor(role)
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
      folioOwner: folioOwnerKeypair.publicKey,
      newActorAuthority: newActorAuthority,
      folioOwnerActor: getActorPDA(folioOwnerKeypair.publicKey, folio),
      newActor: getActorPDA(newActorAuthority, folio),
      folio: folio,
    })
    .instruction();

  await pSendAndConfirmTxn(folioProgram, [addOrUpdateActor], [], {
    skipPreflight: SKIP_PREFLIGHT,
  });
}

export async function removeActor(
  connection: Connection,
  folioOwnerKeypair: Keypair,
  folio: PublicKey,
  actorAuthority: PublicKey,
  role: any = { priceCurator: {} },
  closeActor: boolean
) {
  const folioProgram = getFolioProgram(connection, folioOwnerKeypair);

  const removeActor = await folioProgram.methods
    .removeActor(role, closeActor)
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
      folioOwner: folioOwnerKeypair.publicKey,
      actorAuthority: actorAuthority,
      folioOwnerActor: getActorPDA(folioOwnerKeypair.publicKey, folio),
      actorToRemove: getActorPDA(actorAuthority, folio),
      folio: folio,
    })
    .instruction();

  await pSendAndConfirmTxn(folioProgram, [removeActor], [], {
    skipPreflight: SKIP_PREFLIGHT,
  });
}

export async function addToBasket(
  connection: Connection,
  folioOwnerKeypair: Keypair,
  folio: PublicKey,
  tokens: { mint: PublicKey; amount: BN }[],
  initialShares: BN,
  folioTokenMint: PublicKey
) {
  const folioProgram = getFolioProgram(connection, folioOwnerKeypair);

  const addToBasket = await folioProgram.methods
    .addToBasket(
      tokens.map((token) => token.amount),
      initialShares
    )
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      folioOwner: folioOwnerKeypair.publicKey,
      actor: getActorPDA(folioOwnerKeypair.publicKey, folio),
      folio: folio,
      folioTokenMint,
      ownerFolioTokenAccount: await getOrCreateAtaAddress(
        connection,
        folioTokenMint,
        folioOwnerKeypair,
        folioOwnerKeypair.publicKey
      ),
      folioBasket: getFolioBasketPDA(folio),
    })
    .remainingAccounts(
      await buildRemainingAccounts(
        connection,
        folioOwnerKeypair,
        tokens,
        folioOwnerKeypair.publicKey,
        folio
      )
    )
    .instruction();

  await pSendAndConfirmTxn(folioProgram, [addToBasket], [], {
    skipPreflight: SKIP_PREFLIGHT,
  });
}

export async function removeFromBasket(
  connection: Connection,
  folioOwnerKeypair: Keypair,
  folio: PublicKey,
  tokenToRemove: PublicKey
) {
  const folioProgram = getFolioProgram(connection, folioOwnerKeypair);

  const removeFromBasket = await folioProgram.methods
    .removeFromBasket()
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      folioOwner: folioOwnerKeypair.publicKey,
      actor: getActorPDA(folioOwnerKeypair.publicKey, folio),
      folio: folio,
      folioBasket: getFolioBasketPDA(folio),
      tokenMint: tokenToRemove,
    })
    .instruction();

  await pSendAndConfirmTxn(folioProgram, [removeFromBasket], [], {
    skipPreflight: SKIP_PREFLIGHT,
  });
}

export async function killFolio(
  connection: Connection,
  folioOwnerKeypair: Keypair,
  folio: PublicKey
) {
  const folioProgram = getFolioProgram(connection, folioOwnerKeypair);

  const killFolio = await folioProgram.methods
    .killFolio()
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      folioOwner: folioOwnerKeypair.publicKey,
      actor: getActorPDA(folioOwnerKeypair.publicKey, folio),
      folio: folio,
    })
    .instruction();

  await pSendAndConfirmTxn(folioProgram, [killFolio], [], {
    skipPreflight: SKIP_PREFLIGHT,
  });
}

export async function addToPendingBasket(
  connection: Connection,
  userKeypair: Keypair,
  folio: PublicKey,
  tokens: { mint: PublicKey; amount: BN }[]
) {
  const folioProgram = getFolioProgram(connection, userKeypair);

  const addToPendingBasket = await folioProgram.methods
    .addToPendingBasket(tokens.map((token) => token.amount))
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
      tokenProgram: TOKEN_PROGRAM_ID,
      user: userKeypair.publicKey,

      folio,
      folioBasket: getFolioBasketPDA(folio),
      userPendingBasket: getUserPendingBasketPDA(folio, userKeypair.publicKey),
    })
    .remainingAccounts(
      await buildRemainingAccounts(
        connection,
        userKeypair,
        tokens,
        userKeypair.publicKey,
        folio
      )
    )
    .instruction();

  await pSendAndConfirmTxn(folioProgram, [addToPendingBasket], [], {
    skipPreflight: SKIP_PREFLIGHT,
  });
}

export async function removeFromPendingBasket(
  connection: Connection,
  userKeypair: Keypair,
  folio: PublicKey,
  tokens: { mint: PublicKey; amount: BN }[]
) {
  const folioProgram = getFolioProgram(connection, userKeypair);

  const removeFromPendingBasket = await folioProgram.methods
    .removeFromPendingBasket(tokens.map((token) => token.amount))
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,

      user: userKeypair.publicKey,

      folio,
      folioBasket: getFolioBasketPDA(folio),
      userPendingBasket: getUserPendingBasketPDA(folio, userKeypair.publicKey),
    })
    .remainingAccounts(
      await buildRemainingAccounts(
        connection,
        userKeypair,
        tokens,
        folio,
        userKeypair.publicKey
      )
    )
    .instruction();

  await pSendAndConfirmTxn(folioProgram, [removeFromPendingBasket], [], {
    skipPreflight: SKIP_PREFLIGHT,
  });
}

export async function mintFolioToken(
  connection: Connection,
  userKeypair: Keypair,
  folio: PublicKey,
  folioTokenMint: PublicKey,
  shares: BN,
  minRawShares: BN | null = null
) {
  const folioProgram = getFolioProgram(connection, userKeypair);
  const mintFolioToken = await folioProgram.methods
    .mintFolioToken(shares, minRawShares)
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      user: userKeypair.publicKey,
      daoFeeConfig: getDAOFeeConfigPDA(),
      folioFeeConfig: getFolioFeeConfigPDA(folio),
      folio,
      folioTokenMint,
      folioBasket: getFolioBasketPDA(folio),
      userPendingBasket: getUserPendingBasketPDA(folio, userKeypair.publicKey),
      userFolioTokenAccount: await getOrCreateAtaAddress(
        connection,
        folioTokenMint,
        userKeypair,
        userKeypair.publicKey
      ),
    })
    .instruction();

  await pSendAndConfirmTxn(
    folioProgram,
    [...getComputeLimitInstruction(1_200_000), mintFolioToken],
    [],
    {
      skipPreflight: SKIP_PREFLIGHT,
    },
    true
  );
}

export async function burnFolioToken(
  connection: Connection,
  userKeypair: Keypair,
  folio: PublicKey,
  folioTokenMint: PublicKey,
  amountToBurn: BN,
  minimumOutForTokenAmounts: { mint: PublicKey; minimumOut: BN }[] = []
) {
  const folioProgram = getFolioProgram(connection, userKeypair);

  const burnFolioTokenIx = await folioProgram.methods
    .burnFolioToken(amountToBurn, minimumOutForTokenAmounts)
    .accountsPartial({
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      user: userKeypair.publicKey,
      daoFeeConfig: getDAOFeeConfigPDA(),
      folioFeeConfig: getFolioFeeConfigPDA(folio),
      folio,
      folioTokenMint,
      folioBasket: getFolioBasketPDA(folio),
      userPendingBasket: getUserPendingBasketPDA(folio, userKeypair.publicKey),
      userFolioTokenAccount: await getOrCreateAtaAddress(
        connection,
        folioTokenMint,
        userKeypair,
        userKeypair.publicKey
      ),
    })
    .instruction();

  await pSendAndConfirmTxn(
    folioProgram,
    [...getComputeLimitInstruction(600_000), burnFolioTokenIx],
    [],
    {
      skipPreflight: SKIP_PREFLIGHT,
    }
  );
}

export async function redeemFromPendingBasket(
  connection: Connection,
  userKeypair: Keypair,
  folio: PublicKey,
  tokens: { mint: PublicKey; amount: BN }[]
) {
  const folioProgram = getFolioProgram(connection, userKeypair);

  const redeemFromPendingBasket = await folioProgram.methods
    .redeemFromPendingBasket(tokens.map((token) => token.amount))
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
      tokenProgram: TOKEN_PROGRAM_ID,
      user: userKeypair.publicKey,

      folio,
      folioBasket: getFolioBasketPDA(folio),
      userPendingBasket: getUserPendingBasketPDA(folio, userKeypair.publicKey),
    })
    .remainingAccounts(
      await buildRemainingAccounts(
        connection,
        userKeypair,
        tokens,
        folio,
        userKeypair.publicKey
      )
    )
    .instruction();

  await pSendAndConfirmTxn(folioProgram, [redeemFromPendingBasket], [], {
    skipPreflight: SKIP_PREFLIGHT,
  });
}

export async function pokeFolio(
  connection: Connection,
  userKeypair: Keypair,
  folioPDA: PublicKey,
  folioTokenMint: PublicKey
) {
  const folioProgram = getFolioProgram(connection, userKeypair);

  const pokeFolio = await folioProgram.methods
    .pokeFolio()
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      user: userKeypair.publicKey,
      folio: folioPDA,
      folioTokenMint: folioTokenMint,
      daoFeeConfig: getDAOFeeConfigPDA(),
      folioFeeConfig: getFolioFeeConfigPDA(folioPDA),
    })
    .instruction();

  await pSendAndConfirmTxn(folioProgram, [pokeFolio], [], {
    skipPreflight: SKIP_PREFLIGHT,
  });
}

export async function distributeFees(
  connection: Connection,
  userKeypair: Keypair,
  folio: PublicKey,
  folioTokenMint: PublicKey,
  daoFeeRecipient: PublicKey,
  index: BN
) {
  const folioProgram = getFolioProgram(connection, userKeypair);

  const distributeFees = await folioProgram.methods
    .distributeFees(index)
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
      tokenProgram: TOKEN_PROGRAM_ID,
      user: userKeypair.publicKey,
      daoFeeConfig: getDAOFeeConfigPDA(),
      folioFeeConfig: getFolioFeeConfigPDA(folio),
      folio: folio,
      folioTokenMint,
      feeRecipients: getTVLFeeRecipientsPDA(folio),
      feeDistribution: getFeeDistributionPDA(folio, index),
      daoFeeRecipient,
    })
    .instruction();

  await pSendAndConfirmTxn(folioProgram, [distributeFees], [], {
    skipPreflight: SKIP_PREFLIGHT,
  });
}

export async function crankFeeDistribution(
  connection: Connection,
  userKeypair: Keypair,
  folio: PublicKey,
  folioTokenMint: PublicKey,
  cranker: PublicKey,
  feeDistributionIndex: BN,
  indices: BN[],
  feeRecipients: PublicKey[]
) {
  const folioProgram = getFolioProgram(connection, userKeypair);

  const remainingAccounts = feeRecipients.map((recipient) => {
    return {
      isWritable: true,
      isSigner: false,
      pubkey: recipient,
    };
  });

  const crankFeeDistribution = await folioProgram.methods
    .crankFeeDistribution(indices)
    .accountsPartial({
      rent: SYSVAR_RENT_PUBKEY,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      user: userKeypair.publicKey,
      folio: folio,
      folioTokenMint,
      cranker,
      feeDistribution: getFeeDistributionPDA(folio, feeDistributionIndex),
    })
    .remainingAccounts(remainingAccounts)
    .instruction();

  await pSendAndConfirmTxn(folioProgram, [crankFeeDistribution], [], {
    skipPreflight: SKIP_PREFLIGHT,
  });
}

export async function startRebalance(
  connection: Connection,
  rebalanceManagerKeypair: Keypair,
  folio: PublicKey,
  folioTokenMint: PublicKey,
  auctionLauncherWindow: number,
  ttl: number,
  pricesAndLimits: {
    prices: { low: BN; high: BN };
    limits: { spot: BN; low: BN; high: BN };
  }[],
  allRebalanceDetailsAdded: boolean,
  mints: PublicKey[]
) {
  const folioProgram = getFolioProgram(connection, rebalanceManagerKeypair);

  const remainingAccounts = mints.map((mint) => {
    return {
      isWritable: false,
      isSigner: false,
      pubkey: mint,
    };
  });
  const startRebalance = await folioProgram.methods
    .startRebalance(
      new BN(auctionLauncherWindow),
      new BN(ttl),
      pricesAndLimits,
      allRebalanceDetailsAdded
    )
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      rebalanceManager: rebalanceManagerKeypair.publicKey,
      actor: getActorPDA(rebalanceManagerKeypair.publicKey, folio),
      folio,
      folioTokenMint,
      rebalance: getRebalancePDA(folio),
    })
    .remainingAccounts(remainingAccounts)
    .instruction();

  await pSendAndConfirmTxn(folioProgram, [startRebalance], [], {
    skipPreflight: SKIP_PREFLIGHT,
  });
}

export async function openAuction(
  connection: Connection,
  auctionLauncherKeypair: Keypair,
  folio: PublicKey,
  folioTokenMint: PublicKey,
  auction: PublicKey,
  rebalanceNonce: BN,
  sellLimit: BN,
  buyLimit: BN,
  startPrice: BN,
  endPrice: BN,
  sellMint: PublicKey,
  buyMint: PublicKey
) {
  const folioProgram = getFolioProgram(connection, auctionLauncherKeypair);

  const compare = new PublicKey(sellMint)
    .toBuffer()
    .compare(new PublicKey(buyMint).toBuffer());
  let token1, token2: PublicKey;
  if (compare > 0) {
    token1 = buyMint;
    token2 = sellMint;
  } else {
    token1 = sellMint;
    token2 = buyMint;
  }

  const openAuction = await folioProgram.methods
    .openAuction(token1, token2, sellLimit, buyLimit, startPrice, endPrice)
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      auctionLauncher: auctionLauncherKeypair.publicKey,
      actor: getActorPDA(auctionLauncherKeypair.publicKey, folio),
      folio,
      auctionEnds: getAuctionEndsPDA(folio, rebalanceNonce, token1, token2),
      auction,
      buyMint,
      sellMint,
      folioTokenMint,
    })
    .instruction();

  await pSendAndConfirmTxn(
    folioProgram,
    [...getComputeLimitInstruction(400_000), openAuction],
    [],
    {
      skipPreflight: SKIP_PREFLIGHT,
    }
  );
}

export async function openAuctionPermissionless(
  connection: Connection,
  userKeypair: Keypair,
  folio: PublicKey,
  auction: PublicKey,
  sellMint: PublicKey,
  buyMint: PublicKey
) {
  const folioProgram = getFolioProgram(connection, userKeypair);
  const compare = new PublicKey(sellMint)
    .toBuffer()
    .compare(new PublicKey(buyMint).toBuffer());
  let token1, token2: PublicKey;
  if (compare < 0) {
    token1 = sellMint;
    token2 = buyMint;
  } else {
    token1 = buyMint;
    token2 = sellMint;
  }
  const openAuctionPermissionless = await folioProgram.methods
    .openAuctionPermissionless(token1, token2)
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      user: userKeypair.publicKey,
      folio,
      auction,
      sellMint,
      buyMint,
    })
    .instruction();

  await pSendAndConfirmTxn(folioProgram, [openAuctionPermissionless], [], {
    skipPreflight: SKIP_PREFLIGHT,
  });
}

export async function killAuction(
  connection: Connection,
  auctionActorKeypair: Keypair,
  folio: PublicKey,
  auction: PublicKey,
  rebalanceNonce: BN,
  sellMint: PublicKey,
  buyMint: PublicKey
) {
  const folioProgram = getFolioProgram(connection, auctionActorKeypair);

  const closeAuction = await folioProgram.methods
    .closeAuction()
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      auctionActor: auctionActorKeypair.publicKey,
      actor: getActorPDA(auctionActorKeypair.publicKey, folio),
      folio,
      auction,
      auctionEnds: getAuctionEndsPDA(folio, rebalanceNonce, sellMint, buyMint),
    })
    .instruction();

  await pSendAndConfirmTxn(folioProgram, [closeAuction], [], {
    skipPreflight: SKIP_PREFLIGHT,
  });
}

export async function bid(
  connection: Connection,
  bidderKeypair: Keypair,
  folio: PublicKey,
  folioTokenMint: PublicKey,
  auction: PublicKey,
  sellAmount: BN,
  maxBuyAmount: BN,
  withCallback: boolean = false,
  callbackData: Buffer = Buffer.from([]),
  remainingAccountsForCallback: {
    isWritable: boolean;
    isSigner: boolean;
    pubkey: PublicKey;
  }[] = []
) {
  const folioProgram = getFolioProgram(connection, bidderKeypair);

  const auctionFetched = await folioProgram.account.auction.fetch(auction);

  const bid = await folioProgram.methods
    .bid(sellAmount, maxBuyAmount, withCallback, callbackData)
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      bidder: bidderKeypair.publicKey,
      folio,
      folioBasket: getFolioBasketPDA(folio),
      auction,
      folioTokenMint,
      auctionSellTokenMint: auctionFetched.sellMint,
      auctionBuyTokenMint: auctionFetched.buyMint,
      auctionEnds: getAuctionEndsPDA(
        folio,
        auctionFetched.nonce,
        auctionFetched.sellMint,
        auctionFetched.buyMint
      ),
      folioSellTokenAccount: await getOrCreateAtaAddress(
        connection,
        auctionFetched.sellMint,
        bidderKeypair,
        folio
      ),
      folioBuyTokenAccount: await getOrCreateAtaAddress(
        connection,
        auctionFetched.buyMint,
        bidderKeypair,
        folio
      ),
      bidderSellTokenAccount: await getOrCreateAtaAddress(
        connection,
        auctionFetched.sellMint,
        bidderKeypair,
        bidderKeypair.publicKey
      ),
      bidderBuyTokenAccount: await getOrCreateAtaAddress(
        connection,
        auctionFetched.buyMint,
        bidderKeypair,
        bidderKeypair.publicKey
      ),
    })
    .remainingAccounts(remainingAccountsForCallback)
    .instruction();

  await pSendAndConfirmTxn(
    folioProgram,
    [...getComputeLimitInstruction(400_000), bid],
    [],
    {
      skipPreflight: SKIP_PREFLIGHT,
    }
  );
}

export async function startFolioMigration(
  connection: Connection,
  folioOwnerKeypair: Keypair,
  folioTokenMint: PublicKey,
  oldFolio: PublicKey,
  newFolio: PublicKey,
  newFolioProgram: PublicKey,
  maxAllowedPendingFees: BN
) {
  const folioProgram = getFolioProgram(connection, folioOwnerKeypair);

  const startFolioMigration = await folioProgram.methods
    .startFolioMigration(maxAllowedPendingFees)
    .accountsPartial({
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      folioOwner: folioOwnerKeypair.publicKey,
      programRegistrar: getProgramRegistrarPDA(),
      actor: getActorPDA(folioOwnerKeypair.publicKey, oldFolio),
      newFolioProgram,
      oldFolio,
      newFolio,
      folioTokenMint,
      newFolioBasket: getFolioBasketPDA(newFolio, newFolioProgram),
      newActor: getActorPDA(folioOwnerKeypair.publicKey, newFolio, true),
    })
    .instruction();

  await pSendAndConfirmTxn(folioProgram, [startFolioMigration], [], {
    skipPreflight: SKIP_PREFLIGHT,
  });
}

export async function migrateFolioTokens(
  connection: Connection,
  userKeypair: Keypair,
  oldFolio: PublicKey,
  newFolio: PublicKey,
  newFolioProgram: PublicKey,
  folioTokenMint: PublicKey,
  tokenMints: PublicKey[]
) {
  const folioProgram = getFolioProgram(connection, userKeypair);

  const migrateFolioTokens = await folioProgram.methods
    .migrateFolioTokens()
    .accountsPartial({
      tokenProgram: TOKEN_PROGRAM_ID,
      user: userKeypair.publicKey,
      programRegistrar: getProgramRegistrarPDA(),
      newFolioProgram,
      oldFolio,
      oldFolioBasket: getFolioBasketPDA(oldFolio),
      newFolio,
      folioTokenMint,
      newFolioBasket: getFolioBasketPDA(newFolio, newFolioProgram),
    })
    .remainingAccounts(
      await buildRemainingAccountsForMigrateFolioTokens(
        connection,
        userKeypair,
        oldFolio,
        newFolio,
        tokenMints
      )
    )
    .instruction();

  await pSendAndConfirmTxn(folioProgram, [migrateFolioTokens], [], {
    skipPreflight: SKIP_PREFLIGHT,
  });
}
