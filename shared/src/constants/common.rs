use anchor_lang::prelude::*;
use spl_math::uint::U256;

/*
Included in build

ADMIN
SPL_GOVERNANCE_PROGRAM_ID
*/
include!(concat!(env!("OUT_DIR"), "/config.rs"));

pub const ONE_U256: U256 = U256([1, 0, 0, 0]); // 1
pub const D9_U256: U256 = U256([1_000_000_000, 0, 0, 0]); // 1e9
pub const D18_U256: U256 = U256([1_000_000_000_000_000_000, 0, 0, 0]); // 1e18

pub const D9_U128: u128 = 1_000_000_000; // 1e9
pub const D18_U128: u128 = 1_000_000_000_000_000_000; // 1e18

pub const MAX_DAO_FEE: u128 = 500_000_000_000_000_000; // 50% in 1e18
pub const MAX_FEE_FLOOR: u128 = 1_500_000_000_000_000; // 15 bps in 1e18
pub const FEE_DENOMINATOR: u128 = 1_000_000_000_000_000_000; // 1e18

pub const MAX_TVL_FEE: u128 = 100_000_000_000_000_000; // D18{1/year} 10% annually
pub const YEAR_IN_SECONDS: u64 = 31_536_000; // 31536000 seconds in a year

pub const MAX_MINT_FEE: u128 = 50_000_000_000_000_000; // D18{1} 5%
pub const MIN_AUCTION_LENGTH: u64 = 60; // 1 minute
pub const MAX_AUCTION_LENGTH: u64 = 604800; // 1 week
pub const MAX_AUCTION_DELAY: u64 = 604800; // 1 week
pub const MAX_TTL: u64 = 604800 * 4; // 4 weeks
pub const MAX_RATE: u128 = 1_000_000_000_000_000_000_000_000_000; // 1e27
pub const MAX_PRICE_RANGE: u128 = D9_U128; // 1e9

pub const MAX_FEE_RECIPIENTS: usize = 64;
pub const MAX_FEE_RECIPIENTS_PORTION: u128 = 1_000_000_000_000_000_000; // 1e18
pub const MAX_FOLIO_TOKEN_AMOUNTS: usize = 16;
pub const MAX_USER_PENDING_BASKET_TOKEN_AMOUNTS: usize = 20; // Higher than our 16 maximum token, since they can have tokens that have been removed / added
pub const MAX_CONCURRENT_AUCTIONS: usize = 16;
pub const MAX_REWARD_TOKENS: usize = 5; // Is a hard limit, since we need accrue rewards to be atomic

pub const MAX_REWARD_HALF_LIFE: u64 = 604800 * 2; // 2 weeks
pub const MIN_REWARD_HALF_LIFE: u64 = 86400; // 1 day
pub const LN_2: u128 = 693_147_180_559_945_309; // ln(2)

// Used to validate the folio program seeds on the set folio fee config
pub const FOLIO_PROGRAM_ID: Pubkey = pubkey!("n6sR7Eg5LMg5SGorxK9q3ZePHs9e8gjoQ7TgUW2YCaG");

pub enum PendingBasketType {
    MintProcess,
    RedeemProcess,
}
