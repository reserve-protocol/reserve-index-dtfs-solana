use crate::utils::structs::Prices;
use anchor_lang::prelude::*;
use bytemuck::{Pod, Zeroable};

#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, Zeroable, Pod, PartialEq, Debug,
)]
#[repr(C)]
#[derive(Default)]
/// For each auction run, we will store the start, end, and price.
pub struct AuctionRunDetails {
    /// Scaled in seconds, inclusive
    /// If zero, the auction run was never ran.
    pub start: u64,

    /// Scaled in seconds, inclusive
    pub end: u64,

    /// D18{buyToken/sellToken}
    pub prices: Prices,

    /// D18{tok/share}
    pub sell_limit_spot: u128,

    /// D18{tok/share}
    pub buy_limit_spot: u128,

    /// D18{1} price = startPrice * e ^ -kt
    pub k: u128,
}
