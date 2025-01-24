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
pub struct Range {
    pub spot: u128,
    pub low: u128,
    pub high: u128,
}
