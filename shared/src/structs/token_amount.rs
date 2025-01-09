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
    pub decimals: u8,
    pub _padding: [u8; 7],
    pub amount_for_minting: u64,
    pub amount_for_redeeming: u64,
}
