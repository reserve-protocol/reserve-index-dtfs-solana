use crate::utils::math_util::U256Number;
use anchor_lang::prelude::*;

#[event]
pub struct FolioCreated {
    pub folio_token_mint: Pubkey,
}

#[event]
pub struct FolioKilled {}

#[event]
pub struct BasketTokenAdded {
    pub token: Pubkey,
}

#[event]
pub struct BasketTokenRemoved {
    pub token: Pubkey,
}

#[event]
pub struct TVLFeeSet {
    pub new_fee: u128,
}

#[event]
pub struct MintFeeSet {
    pub new_fee: u128,
}

#[event]
pub struct FeeRecipientSet {
    pub recipient: Pubkey,
    pub portion: u64,
}

#[event]
pub struct TVLFeePaid {
    pub recipient: Pubkey,
    pub amount: u64,
}

#[event]
pub struct ProtocolFeePaid {
    pub recipient: Pubkey,
    pub amount: u64,
}

#[event]
pub struct AuctionOpened {
    pub auction_id: u64,
    pub start_price: u128,
    pub end_price: u128,
    pub start: u64,
    pub end: u64,
}

#[event]
pub struct AuctionApproved {
    pub auction_id: u64,
    pub from: Pubkey,
    pub to: Pubkey,
    pub amount: u64,
    pub start_price: u128,
}

#[event]
pub struct AuctionClosed {
    pub auction_id: u64,
}

#[event]
pub struct AuctionBid {
    pub auction_id: u64,
    pub sell_amount: u64,
    pub bought_amount: u64,
}

#[event]
pub struct AuctionDelaySet {
    pub new_auction_delay: u64,
}

#[event]
pub struct AuctionLengthSet {
    pub new_auction_length: u64,
}

#[event]
pub struct RewardTokenAdded {
    pub reward_token: Pubkey,
}

#[event]
pub struct RewardRatioSet {
    pub reward_ratio: U256Number,
    pub reward_half_life: u64,
}

#[event]
pub struct RewardTokenRemoved {
    pub reward_token: Pubkey,
}

#[event]
pub struct MandateSet {
    pub new_mandate: Pubkey,
}
