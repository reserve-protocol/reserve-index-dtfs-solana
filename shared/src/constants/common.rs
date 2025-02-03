use anchor_lang::prelude::*;
use spl_math::uint::U256;

/*
Included in build

ADMIN
*/
include!(concat!(env!("OUT_DIR"), "/config.rs"));

pub const D9: U256 = U256([1_000_000_000, 0, 0, 0]); // 1e9
pub const D18: U256 = U256([1_000_000_000_000_000_000, 0, 0, 0]); // 1e18
pub const D27: U256 = U256([0, 54_210_108_624_275_221, 0, 0]); // 1e27

pub const MAX_DAO_FEE: u128 = 500_000_000_000_000_000; // 50% in 1e18
pub const DAO_FEE_DENOMINATOR: u128 = 1_000_000_000_000_000_000; // 1e18

pub const MAX_FOLIO_FEE: u128 = 500_000_000_000_000_000; // D18{1/year} 50% annually
pub const ANNUALIZATION_EXP: U256 = U256([31_709_791_983, 0, 0, 0]); // D18{1/s} 1 / 31536000

pub const MAX_MINTING_FEE: u128 = 100_000_000_000_000_000; // D18{1} 10%
pub const MIN_DAO_MINTING_FEE: u128 = 500_000_000_000_000; // D18{1} 5 bps

pub const MIN_AUCTION_LENGTH: u64 = 60; // 1 minute
pub const MAX_AUCTION_LENGTH: u64 = 604800; // 1 week
pub const MAX_TRADE_DELAY: u64 = 604800; // 1 week
pub const MAX_TTL: u64 = 604800 * 4; // 4 weeks
pub const MAX_RATE: u128 = 1_000_000_000_000_000_000_000_000_000; // 1e27 (can't do 1e54 like evm)
pub const MAX_PRICE_RANGE: u128 = 1_000_000_000; // 1e9

pub const MAX_FEE_RECIPIENTS: usize = 64;
pub const MAX_FEE_RECIPIENTS_PORTION: u64 = 1_000_000_000; // 1e9
pub const MAX_FOLIO_TOKEN_AMOUNTS: usize = 16;
pub const MAX_USER_PENDING_BASKET_TOKEN_AMOUNTS: usize = 20; // Higher than our 16 maximum token, since they can have tokens that have been removed / added
pub const MAX_CONCURRENT_TRADES: usize = 16;
pub const MAX_REWARD_TOKENS: usize = 30; // Isn't a hard limit, but to specify account size, we'll use it

pub const MAX_REWARD_HALF_LIFE: u64 = 604800 * 2; // 2 weeks
pub const MIN_REWARD_HALF_LIFE: u64 = 86400; // 1 day
pub const LN_2: u128 = 693_147_180_559_945_309; //

pub enum PendingBasketType {
    MintProcess,
    RedeemProcess,
}
