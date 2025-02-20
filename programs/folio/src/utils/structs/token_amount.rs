use anchor_lang::prelude::*;
use bytemuck::{Pod, Zeroable};

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
pub struct TokenAmount {
    pub mint: Pubkey,

    /// Scaled in D9
    pub amount_for_minting: u64,

    /// Scaled in D9
    pub amount_for_redeeming: u64,
}
