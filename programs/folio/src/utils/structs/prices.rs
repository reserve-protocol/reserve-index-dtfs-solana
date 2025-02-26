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
pub struct Prices {
    /// D18{buyTok/sellTok}
    pub start: u128,

    /// D18{buyTok/sellTok}
    pub end: u128,
}
