//! Common constants for the program.

use anchor_lang::prelude::*;
use spl_math::uint::U256;

#[cfg(feature = "test")]
mod keys {
    use super::*;
    pub const ADMIN: Pubkey = pubkey!("AXF3tTrMUD5BLzv5Fmyj63KXwvkuGdxMQemSJHtTag4j");
    pub const SPL_GOVERNANCE_PROGRAM_ID: Pubkey =
        pubkey!("HwXcHGabc19PxzYFVSfKvuaDSNpbLGL8fhVtkcTyEymj");
}
#[cfg(all(feature = "dev", not(feature = "test")))]
mod keys {
    use super::*;
    pub const ADMIN: Pubkey = pubkey!("AXF3tTrMUD5BLzv5Fmyj63KXwvkuGdxMQemSJHtTag4j");
    pub const SPL_GOVERNANCE_PROGRAM_ID: Pubkey =
        pubkey!("HwXcHGabc19PxzYFVSfKvuaDSNpbLGL8fhVtkcTyEymj");
}
#[cfg(all(not(feature = "dev"), not(feature = "test")))]
mod keys {
    use super::*;
    pub const ADMIN: Pubkey = pubkey!("BesRAQsmAL45fGMJHNqP8xNT51Nr9ewvpzUzTRiU8A1M");
    // TODO: Change key and update program if we want to have daos.
    // We don't plan to deploy the SPL governance program on mainnet.
    // Setting key to default key.
    pub const SPL_GOVERNANCE_PROGRAM_ID: Pubkey = pubkey!("11111111111111111111111111111111");
}

pub use keys::*;

// Constants for scaling
pub const ONE_U256: U256 = U256([1, 0, 0, 0]); // 1
pub const D9_U256: U256 = U256([1_000_000_000, 0, 0, 0]); // 1e9 (D9)
pub const D18_U256: U256 = U256([1_000_000_000_000_000_000, 0, 0, 0]); // 1e18 (D18)
pub const D9_U128: u128 = 1_000_000_000; // 1e9 (D9)
pub const D18_U128: u128 = 1_000_000_000_000_000_000; // 1e18 (D18)

/// MAX_DAO_FEE is the maximum fee that can be set for the DAO, 50% in D18.
pub const MAX_DAO_FEE: u128 = 500_000_000_000_000_000;
/// MAX_FEE_FLOOR is the maximum fee floor that can be set for the DAO, 15 bps in D18.
pub const MAX_FEE_FLOOR: u128 = 1_500_000_000_000_000;
/// FEE_DENOMINATOR is the denominator for the fee, 1e18.
pub const FEE_DENOMINATOR: u128 = 1_000_000_000_000_000_000;

/// MAX_TVL_FEE is the maximum fee that can be set for the TVL fee, D18{1/year} -> 10% annually in D18.
pub const MAX_TVL_FEE: u128 = 100_000_000_000_000_000;

/// DAY_IN_SECONDS is the number of se conds in a day.
pub const DAY_IN_SECONDS: u64 = 86400;

/// YEAR_IN_SECONDS is the number of seconds in a year.
pub const YEAR_IN_SECONDS: u64 = 365 * DAY_IN_SECONDS;

/// MAX_MINT_FEE is the maximum fee that can be set for the mint fee, 5% in D18 (D18{1} 5%).
pub const MAX_MINT_FEE: u128 = 50_000_000_000_000_000;

/// MIN_AUCTION_LENGTH is the minimum auction length, 1 minute.
pub const MIN_AUCTION_LENGTH: u64 = 60;
/// MAX_AUCTION_LENGTH is the maximum auction length, 1 week.
pub const MAX_AUCTION_LENGTH: u64 = 604800;

/// MAX_TTL is the maximum TTL, 4 weeks.
pub const MAX_TTL: u64 = 604800 * 4;

/// MAX_RATE is the maximum rate used in buy and sell limits, 1e27.
pub const MAX_RATE: u128 = 1_000_000_000_000_000_000_000_000_000;

/// MAX_PRICE_RANGE is the maximum price range, 1e9.
pub const MAX_PRICE_RANGE: u128 = D9_U128;

// Maximum price range for a token, 100.
pub const MAX_TOKEN_PRICE_RANGE: u128 = 100;

/// MAX_TOKEN_PRICE is the maximum price for a token, 1e36.
pub const MAX_TOKEN_PRICE: u128 = D18_U128 * D18_U128;

pub const RESTRICTED_AUCTION_BUFFER: u64 = 0;

/// MAX_FEE_RECIPIENTS is the maximum number of fee recipients, 64.
pub const MAX_FEE_RECIPIENTS: usize = 64;
/// MAX_FEE_RECIPIENTS_PORTION is the maximum portion of the fee that can be set for a fee recipient, 1e18.
pub const MAX_FEE_RECIPIENTS_PORTION: u128 = 1_000_000_000_000_000_000;
/// MAX_FOLIO_TOKEN_AMOUNTS is the maximum number of token amounts that can be set for a folio, 16.
pub const MAX_FOLIO_TOKEN_AMOUNTS: usize = 100;

/// MAX_USER_PENDING_BASKET_TOKEN_AMOUNTS is the maximum number of token amounts that can be set for a user pending
/// basket, 110, higher than our 100 maximum token, since they can have tokens that have been removed / added
pub const MAX_USER_PENDING_BASKET_TOKEN_AMOUNTS: usize = 110;

/// MAX_REBALANCE_DETAILS_TOKENS is the maximum number of tokens that can be rebalanced at once, 30.
pub const MAX_REBALANCE_DETAILS_TOKENS: usize = 30;

/// MAX_CONCURRENT_AUCTIONS is the maximum number of concurrent auctions that can be set for a folio, 16.
pub const MAX_CONCURRENT_AUCTIONS: usize = 16;
/// MAX_REWARD_TOKENS is the maximum number of reward tokens that can be set for a folio, 4.
pub const MAX_REWARD_TOKENS: usize = 4;

/// MAX_REWARD_HALF_LIFE is the maximum half life of a reward token, 2 weeks.
pub const MAX_REWARD_HALF_LIFE: u64 = 604800 * 2;
/// MIN_REWARD_HALF_LIFE is the minimum half life of a reward token, 1 day.
pub const MIN_REWARD_HALF_LIFE: u64 = 86400;
/// LN_2 is the natural logarithm of 2, 693147180559945309. Used in reward token calculations. In D18.
pub const LN_2: u128 = 693_147_180_559_945_309;

/// FOLIO_PROGRAM_ID is the program id of the folio program, used to validate the folio program seeds on the set folio fee config
pub const FOLIO_PROGRAM_ID: Pubkey = pubkey!("DTF4yDGBkXJ25Ech1JVQpfwVb1vqYW4RJs5SuGNWdDev");

/// REWARDS_PROGRAM_ID is the program id of the rewards program, used to validate the rewards program seeds on the set folio fee config
pub const REWARDS_PROGRAM_ID: Pubkey = pubkey!("7GiMvNDHVY8PXWQLHjSf1REGKpiDsVzRr4p7Y3xGbSuf");

pub enum PendingBasketType {
    MintProcess,
    RedeemProcess,
}
