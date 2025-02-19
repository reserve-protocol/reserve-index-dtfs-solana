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
    /// Scaled in D18
    pub new_fee: u128,
}

#[event]
pub struct MintFeeSet {
    /// Scaled in D18
    pub new_fee: u128,
}

#[event]
pub struct FeeRecipientSet {
    pub recipient: Pubkey,

    /// Scaled in D18
    pub portion: u128,
}

#[event]
pub struct TVLFeePaid {
    pub recipient: Pubkey,

    /// Scaled in D9
    pub amount: u64,
}

#[event]
pub struct ProtocolFeePaid {
    pub recipient: Pubkey,

    /// Scaled in D9
    pub amount: u64,
}

#[event]
pub struct AuctionOpened {
    pub auction_id: u64,

    /// Scaled in D18
    pub start_price: u128,

    /// Scaled in D18
    pub end_price: u128,

    /// Scaled in time units
    pub start: u64,

    /// Scaled in time units
    pub end: u64,
}

#[event]
pub struct AuctionApproved {
    pub auction_id: u64,
    pub from: Pubkey,
    pub to: Pubkey,

    /// Scaled in D9
    pub amount: u64,

    /// Scaled in D18
    pub start_price: u128,
}

#[event]
pub struct AuctionClosed {
    pub auction_id: u64,
}

#[event]
pub struct AuctionBid {
    pub auction_id: u64,

    /// Scaled in D9
    pub sell_amount: u64,

    /// Scaled in D9
    pub bought_amount: u64,
}

#[event]
pub struct AuctionDelaySet {
    /// Scaled in time units
    pub new_auction_delay: u64,
}

#[event]
pub struct AuctionLengthSet {
    /// Scaled in time units    
    pub new_auction_length: u64,
}

#[event]
pub struct RewardTokenAdded {
    pub reward_token: Pubkey,
}

#[event]
pub struct RewardRatioSet {
    /// Scaled in D18
    pub reward_ratio: u128,

    /// Scaled in time units
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
