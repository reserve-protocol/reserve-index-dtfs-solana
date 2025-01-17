use anchor_lang::prelude::*;

/*
Included in build

ADMIN
*/
include!(concat!(env!("OUT_DIR"), "/config.rs"));

pub const DECIMAL_TOKEN: u64 = 1_000_000_000; // 10^9 (9 decimals for tokens in Solana)

pub const MAX_DAO_FEE: u64 = 500_000_000; // 50%

pub const SCALAR: u64 = 1_000_000_000; // 1
pub const SCALAR_U128: u128 = 1_000_000_000; // 1

pub const DAO_FEE_DENOMINATOR: u64 = 1_000_000_000; // 1

pub const MAX_FOLIO_FEE: u64 = 13_284; // D9{1/s} 50% annually

pub const MIN_DAO_MINTING_FEE: u64 = 500_000; // 5bps
pub const MAX_MINTING_FEE: u64 = 100_000_000; //0.1 (10%)

pub const MIN_AUCTION_LENGTH: u64 = 60; // 1 minute
pub const MAX_AUCTION_LENGTH: u64 = 604800; // 1 week
pub const MAX_TRADE_DELAY: u64 = 604800; // 1 week
pub const MAX_TTL: u64 = 604800 * 4; // 4 weeks
pub const MAX_RATE: u64 = 1_000_000_000; // 1e9
pub const MAX_PRICE_RANGE: u64 = 1_000_000_000; // 1e9

pub const MAX_FEE_RECIPIENTS: usize = 64;
pub const MAX_TOKEN_AMOUNTS: usize = 16;
pub const MAX_CONCURRENT_TRADES: usize = 16; // TODO
pub const MAX_REWARD_TOKENS: usize = 30; // Isn't a hard limit, but to specify account size, we'll use it

pub const MAX_REWARD_HALF_LIFE: u64 = 604800 * 2; // 2 weeks
pub const MIN_REWARD_HALF_LIFE: u64 = 86400; // 1 day
pub const LN_2: u128 = 693_147_180_559_945_309; //

pub enum PendingBasketType {
    MintProcess,
    RedeemProcess,
}
