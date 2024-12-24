use anchor_lang::prelude::*;
use bytemuck::{Pod, Zeroable};

use crate::constants::MAX_TOKEN_AMOUNTS;

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
    pub amount: u64,
}
