use anchor_lang::prelude::*;

use crate::structs::DecimalValue;

/*
Included in build

ADMIN
*/
include!(concat!(env!("OUT_DIR"), "/config.rs"));

pub const SCALAR_TOKEN: u64 = 1_000_000_000; // 10^9 (9 decimals for tokens in Solana)

pub const DAO_FEE_DENOMINATOR: DecimalValue = DecimalValue::SCALAR;
pub const MAX_FOLIO_FEE: DecimalValue = DecimalValue {
    whole: 0,
    fractional: 21979552668,
};
pub const MIN_DAO_MINTING_FEE: DecimalValue = DecimalValue {
    whole: 0,
    fractional: 500_000_000_000_000, // 0.0005 * 10^18
};
pub const MAX_MINTING_FEE: DecimalValue = DecimalValue {
    whole: 0,
    fractional: 100_000_000_000_000_000, // 0.1 * 10^18
};

pub const MIN_AUCTION_LENGTH: u64 = 60; // 1 minute
pub const MAX_AUCTION_LENGTH: u64 = 604800; // 1 week
pub const MAX_TRADE_DELAY: u64 = 604800; // 1 week
pub const MAX_TTL: u64 = 604800 * 4; // 4 weeks

pub const MAX_FEE_RECIPIENTS: usize = 64;
pub const MAX_TOKEN_AMOUNTS: usize = 16; // TODO verify

pub enum PendingBasketType {
    MintProcess,
    RedeemProcess,
}
