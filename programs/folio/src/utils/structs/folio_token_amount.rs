use anchor_lang::prelude::*;
use bytemuck::{Pod, Zeroable};
use shared::constants::MAX_FOLIO_TOKEN_AMOUNTS;

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

    /// Raw amount of the token.
    pub amount: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace)]
#[repr(C)]
pub struct FolioTokenBasket {
    /// We do it like this to be able to use the zerocopy traits.
    pub token_amounts: [FolioTokenAmount; MAX_FOLIO_TOKEN_AMOUNTS],
}

impl Default for FolioTokenBasket {
    fn default() -> Self {
        Self {
            token_amounts: [FolioTokenAmount::default(); MAX_FOLIO_TOKEN_AMOUNTS],
        }
    }
}

/// From the crate these are only derived for array of some sizes, we wanted a specific one for an array of 100.
/// The ones close to the limit that comes in library are size 96 and 128.
/// If we go with 128 we will increase the iteration in some parts of the smart contract.
unsafe impl Pod for FolioTokenBasket {}
unsafe impl Zeroable for FolioTokenBasket {}
