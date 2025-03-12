use anchor_lang::prelude::*;
use bytemuck::{Pod, Zeroable};

/// Store the amount of tokens in the folio basket and the mint of the token.
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
pub struct FolioTokenAmount {
    /// The mint of the token.
    pub mint: Pubkey,

    /// Scaled in D9
    pub amount: u64,
}
