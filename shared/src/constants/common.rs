use anchor_lang::prelude::*;

/*
Included in build

ADMIN
*/
include!(concat!(env!("OUT_DIR"), "/config.rs"));

pub const PRECISION_FACTOR: u64 = 1_000_000_000;

pub const MAX_FEE_RECIPIENTS: usize = 64;
pub const MAX_PLATFORM_FEE: u64 = 500_000_000;

pub const MAX_TOKEN_AMOUNTS: usize = 23;

pub enum PendingTokenAmountsType {
    MintProcess,
    RedeemProcess,
}
