use anchor_lang::prelude::*;
use bytemuck::{Pod, Zeroable};

#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, Zeroable, Pod, PartialEq, Debug,
)]
#[repr(C)]
pub struct TradeEnd {
    pub mint: Pubkey,
    pub end_time: u64,
}

impl Default for TradeEnd {
    fn default() -> Self {
        Self {
            mint: Pubkey::default(),
            end_time: 0,
        }
    }
}
