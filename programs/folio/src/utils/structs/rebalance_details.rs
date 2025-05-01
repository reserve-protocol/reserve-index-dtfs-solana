use anchor_lang::prelude::*;
use bytemuck::{Pod, Zeroable};
use shared::constants::MAX_REBALANCE_DETAILS_TOKENS;

use super::{BasketRange, PricesInRebalance};

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
pub struct RebalanceDetailsToken {
    pub mint: Pubkey,

    pub limits: BasketRange,

    pub prices: PricesInRebalance,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace)]
#[repr(C)]
pub struct RebalanceDetails {
    pub tokens: [RebalanceDetailsToken; MAX_REBALANCE_DETAILS_TOKENS],
}

impl Default for RebalanceDetails {
    fn default() -> Self {
        Self {
            tokens: [RebalanceDetailsToken::default(); MAX_REBALANCE_DETAILS_TOKENS],
        }
    }
}

unsafe impl Pod for RebalanceDetails {}
unsafe impl Zeroable for RebalanceDetails {}

// This is taken as input in the start_rebalance instruction
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct RebalancePriceAndLimits {
    pub prices: PricesInRebalance,
    pub limits: BasketRange,
}
