import { BN, Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  BanksClient,
  BanksTransactionResultWithMeta,
  ProgramTestContext,
} from "solana-bankrun";

import {
  createAndSetActor,
  createAndSetFolio,
  FolioTokenAmount,
} from "../bankrun-account-helper";
import { mintToken } from "../bankrun-token-helper";
import { Folio } from "../../../target/types/folio";
import {
  D9,
  DEFAULT_DECIMALS,
  MAX_FOLIO_TOKEN_AMOUNTS,
} from "../../../utils/constants";
import { initToken } from "../bankrun-token-helper";
import { Role } from "../bankrun-account-helper";
import {
  airdrop,
  assertError,
  getConnectors,
  travelFutureSlot,
} from "../bankrun-program-helper";
import {
  getFolioPDA,
  getFolioTokenMetadataPDA,
} from "../../../utils/pda-helper";
import { setDustLimitForToken } from "../bankrun-ix-helper";

import * as assert from "assert";

/**
 * Tests for folio token metadata functionality, including:
 * - Setting dust limit for a token
 */

describe("Bankrun - Folio token metadata", () => {
  let context: ProgramTestContext;
  let banksClient: BanksClient;

  let programFolio: Program<Folio>;

  const folioOwnerKeypair = Keypair.generate();
  const folioTokenMint = Keypair.generate();
  let folioPDA: PublicKey;
  const userKeypair = Keypair.generate();

  const MINTS = Array(MAX_FOLIO_TOKEN_AMOUNTS)
    .fill(null)
    .map(() => Keypair.generate());

  const DEFAULT_PARAMS: {
    tokenMint: PublicKey;
    dustAmount: BN;
  } = {
    tokenMint: MINTS[0].publicKey,
    dustAmount: new BN(1000),
  };

  async function initBaseCase(
    folioBasketTokens: FolioTokenAmount[] = [
      new FolioTokenAmount(MINTS[0].publicKey, new BN(1_000).mul(D9)),
      new FolioTokenAmount(MINTS[1].publicKey, new BN(1_000).mul(D9)),
    ]
  ) {
    await createAndSetFolio(context, programFolio, folioTokenMint.publicKey);

    initToken(context, folioPDA, folioTokenMint, DEFAULT_DECIMALS);

    // Give initial balance of tokens to the folio for each of the mint it has
    for (const mint of folioBasketTokens) {
      initToken(context, folioPDA, mint.mint, DEFAULT_DECIMALS);
      mintToken(context, mint.mint, mint.amount.toNumber(), folioPDA);
    }

    await createAndSetActor(
      context,
      programFolio,
      folioOwnerKeypair,
      folioPDA,
      Role.Owner
    );
  }

  const TEST_CASES_SET_DUST_LIMIT_FOR_TOKEN = [
    {
      desc: "(set dust limit for token, is valid)",
      tokenMint: MINTS[0].publicKey,
      dustAmount: new BN(1000),
      userKeypair: folioOwnerKeypair,
      expectedError: null,
    },
    {
      desc: "(set dust limit for token, is not admin)",
      tokenMint: MINTS[0].publicKey,
      dustAmount: new BN(1000),
      userKeypair: userKeypair,
      expectedError: "InvalidRole",
      beforeCall: () => {
        createAndSetActor(
          context,
          programFolio,
          userKeypair,
          folioPDA,
          Role.BrandManager
        );
      },
    },
    {
      desc: "(set dust limit for token, is auction launcher, is valid)",
      tokenMint: MINTS[0].publicKey,
      dustAmount: new BN(1000),
      userKeypair: userKeypair,
      expectedError: null,
      beforeCall: () => {
        createAndSetActor(
          context,
          programFolio,
          userKeypair,
          folioPDA,
          Role.AuctionLauncher
        );
      },
    },
  ];

  before(async () => {
    ({ programFolio, context } = await getConnectors());

    banksClient = context.banksClient;

    await airdrop(context, folioOwnerKeypair.publicKey, 1000);
    await airdrop(context, userKeypair.publicKey, 1000);

    folioPDA = getFolioPDA(folioTokenMint.publicKey);

    await initBaseCase();
  });

  describe("Specific Cases - Set Dust Limit For Token", () => {
    TEST_CASES_SET_DUST_LIMIT_FOR_TOKEN.forEach(
      ({ desc, expectedError, userKeypair, beforeCall, ...restOfParams }) => {
        describe(`When ${desc}`, () => {
          let txnResult: BanksTransactionResultWithMeta;
          const { tokenMint, dustAmount } = {
            ...DEFAULT_PARAMS,
            ...restOfParams,
          };

          before(async () => {
            await initBaseCase();
            if (beforeCall) {
              beforeCall();
            }

            await travelFutureSlot(context);

            txnResult = await setDustLimitForToken<true>(
              banksClient,
              programFolio,
              userKeypair,
              folioPDA,
              tokenMint,
              dustAmount,
              true
            );
          });

          if (expectedError) {
            it("should fail with expected error", () => {
              assertError(txnResult, expectedError);
            });
          } else {
            it("should succeed", async () => {
              await travelFutureSlot(context);

              const folioTokenMetadata =
                await programFolio.account.folioTokenMetadata.fetch(
                  getFolioTokenMetadataPDA(folioPDA, tokenMint)
                );

              assert.equal(
                folioTokenMetadata.dustAmount.toNumber(),
                dustAmount.toNumber()
              );
              assert.equal(
                folioTokenMetadata.mint.toBase58(),
                tokenMint.toBase58()
              );
              assert.equal(
                folioTokenMetadata.folio.toBase58(),
                folioPDA.toBase58()
              );
            });
          }
        });
      }
    );
  });
});
