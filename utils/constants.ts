import { BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import idlFolio from "../target/idl/folio.json";
import idlDtfs from "../target/idl/dtfs.json";

// Programs
export const DTF_PROGRAM_ID = new PublicKey(idlDtfs.address);
export const FOLIO_PROGRAM_ID = new PublicKey(idlFolio.address);
export const BPF_LOADER_PROGRAM_ID = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111"
);
export const SPL_GOVERNANCE_PROGRAM_ID = new PublicKey(
  "GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw"
);

export const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

export const BPF_PROGRAM_USED_BY_BANKRUN = new PublicKey(
  "BPFLoader2111111111111111111111111111111111"
);

// Other admin key (to be able to test not admin)
export const OTHER_ADMIN_KEY = Keypair.generate();

// Token Constants
export const DEFAULT_DECIMALS = 9;
export const DEFAULT_DECIMALS_MUL = 10 ** DEFAULT_DECIMALS;

export const DEFAULT_PRECISION = new BN(10 ** 9);

// DTF Constants
export const MAX_FOLIO_FEE = new BN("500000000000000000");
export const D18 = new BN("1000000000000000000");
export const MIN_DAO_MINTING_FEE = new BN("500000000000000");
export const MAX_MINTING_FEE = new BN("100000000000000000");
export const MIN_AUCTION_LENGTH = new BN(60);
export const MAX_AUCTION_LENGTH = new BN(604800);
export const MAX_TRADE_DELAY = new BN(604800);
export const MAX_FEE_RECIPIENTS = 64;
export const MAX_FOLIO_TOKEN_AMOUNTS = 16;
export const MAX_USER_PENDING_BASKET_TOKEN_AMOUNTS = 20;
export const TOTAL_PORTION_FEE_RECIPIENT = new BN(1_000_000_000);

export const MAX_CONCURRENT_TRADES = 16;
