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
    /// Scaled in D18
    pub spot: u128,

    /// Scaled in D18
    pub low: u128,

    /// Scaled in D18
    pub high: u128,
}
