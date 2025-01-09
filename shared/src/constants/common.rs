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

pub const MAX_FEE_RECIPIENTS: usize = 64;
pub const MAX_TOKEN_AMOUNTS: usize = 16;

pub enum PendingBasketType {
    MintProcess,
    RedeemProcess,
}
