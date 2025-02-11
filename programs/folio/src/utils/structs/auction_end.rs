use anchor_lang::prelude::*;
use bytemuck::{Pod, Zeroable};

#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, Zeroable, Pod, PartialEq, Debug,
)]
#[repr(C)]
#[derive(Default)]
pub struct AuctionEnd {
    pub mint: Pubkey,
    pub end_time: u64,
}
