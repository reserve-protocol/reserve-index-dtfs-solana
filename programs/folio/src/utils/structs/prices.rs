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
pub struct Prices {
    /// Scaled in D18
    pub start: u128,

    /// Scaled in D18
    pub end: u128,
}
