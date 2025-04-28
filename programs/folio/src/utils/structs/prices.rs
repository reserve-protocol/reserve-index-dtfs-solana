use anchor_lang::prelude::*;
use bytemuck::{Pod, Zeroable};

/// Prices for the Folio when there is an auction.
#[derive(
    AnchorSerialize,
    AnchorDeserialize,
    Default,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Debug,
    InitSpace,
    Zeroable,
    Pod,
)]
#[repr(C)]
/// Scaled in D18
pub struct PricesInAuction {
    /// D18{buyTok/sellTok}
    pub start: u128,

    /// D18{buyTok/sellTok}
    pub end: u128,
}

#[derive(
    AnchorSerialize,
    AnchorDeserialize,
    Default,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Debug,
    InitSpace,
    Zeroable,
    Pod,
)]
#[repr(C)]
/// Scaled in D18, It is completely same as the PricesInAuction struct, but the difference
/// is terms of use, this is for a token price in terms of a common token(USDC/ or some common token) in rebalance details.
pub struct PricesInRebalance {
    /// D18{UoA/tok}
    pub low: u128,

    /// D18{UoA/tok}
    pub high: u128,
}
