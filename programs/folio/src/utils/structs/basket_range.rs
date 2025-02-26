use anchor_lang::prelude::*;
use bytemuck::{Pod, Zeroable};

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
pub struct BasketRange {
    /// D18{tok/share}
    pub spot: u128,

    /// D18{tok/share} inclusive
    pub low: u128,

    /// D18{tok/share} inclusive
    pub high: u128,
}
