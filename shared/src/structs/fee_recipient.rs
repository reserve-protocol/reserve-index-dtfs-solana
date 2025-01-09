use anchor_lang::prelude::*;
use bytemuck::{Pod, Zeroable};

use super::DecimalValue;

#[derive(
    AnchorSerialize,
    AnchorDeserialize,
    Clone,
    Copy,
    Default,
    InitSpace,
    Zeroable,
    Pod,
    PartialEq,
    Debug,
)]
#[repr(C)]
pub struct FeeRecipient {
    pub receiver: Pubkey,
    pub portion: DecimalValue,
}
