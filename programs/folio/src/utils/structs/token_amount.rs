use anchor_lang::prelude::*;
use bytemuck::{Pod, Zeroable};
use shared::constants::MAX_USER_PENDING_BASKET_TOKEN_AMOUNTS;

/// A token amount with a mint and an amount for minting and redeeming.
///
/// Amount for minting is used when the user is trying to mint a folio token (or any action related to minting a folio token).
/// Amount for redeeming is used when the user is trying to redeem a folio token (or any action related to redeeming a folio token).
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

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace)]
#[repr(C)]
pub struct UserTokenBasket {
    pub token_amounts: [TokenAmount; MAX_USER_PENDING_BASKET_TOKEN_AMOUNTS],
}

impl Default for UserTokenBasket {
    fn default() -> Self {
        Self {
            token_amounts: [TokenAmount::default(); MAX_USER_PENDING_BASKET_TOKEN_AMOUNTS],
        }
    }
}

unsafe impl Pod for UserTokenBasket {}
unsafe impl Zeroable for UserTokenBasket {}
