import { BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import idlFolio from "../target/idl/folio.json";
import idlFolioAdmin from "../target/idl/folio_admin.json";
import idlFolioSecond from "../target/idl/second_folio.json";

// Programs
export const FOLIO_ADMIN_PROGRAM_ID = new PublicKey(idlFolioAdmin.address);
export const FOLIO_SECOND_PROGRAM_ID = new PublicKey(idlFolioSecond.address);
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
export const DEFAULT_DECIMALS_MUL_D18 = new BN("1000000000000000000");

export const DEFAULT_PRECISION = new BN(10 ** 9);

export const D9 = new BN("1000000000");
export const D18 = new BN("1000000000000000000");

export const MAX_TVL_FEE = new BN("100000000000000000");
// Estimation of the expected tvl fee when max is set (0.1% error rate)
export const EXPECTED_TVL_FEE_WHEN_MAX = new BN("3334813116");
export const MAX_FEE_FLOOR = new BN("1500000000000000");

export const MAX_DAO_FEE = new BN("500000000000000000");
export const MAX_MINT_FEE = new BN("50000000000000000");

export const MIN_AUCTION_LENGTH = new BN(60);
export const MAX_AUCTION_LENGTH = new BN(604800);
export const MAX_AUCTION_DELAY = new BN(604800);
export const MAX_TTL = new BN(604800 * 4);
// 1e27 = 1000000000000000000000000000
export const MAX_RATE = new BN("1000000000000000000000000000");

export const MAX_FEE_RECIPIENTS = 64;
export const MAX_FOLIO_TOKEN_AMOUNTS = 16;
export const MAX_USER_PENDING_BASKET_TOKEN_AMOUNTS = 20;
export const TOTAL_PORTION_FEE_RECIPIENT = new BN("1000000000000000000");
export const MAX_REWARD_TOKENS = 30;
export const MAX_CONCURRENT_AUCTIONS = 16;

export const MAX_PADDED_STRING_LENGTH = 128;

export const MAX_REWARD_HALF_LIFE = new BN(1_209_600);
export const MIN_REWARD_HALF_LIFE = new BN(86400);
