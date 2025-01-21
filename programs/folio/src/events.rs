use anchor_lang::prelude::*;

#[event]
pub struct FolioCreated {
    pub folio_token_mint: Pubkey,
    pub folio_fee: u64,
}

#[event]
pub struct ProgramRegistryUpdate {
    pub program_ids: Vec<Pubkey>,
    pub remove: bool,
}

#[event]
pub struct BasketTokenAdded {
    pub token: Pubkey,
}

#[event]
pub struct BasketTokenRemoved {
    pub token: Pubkey,
}

#[event]
pub struct FolioFeeSet {
    pub new_fee: u64,
}

#[event]
pub struct FeeRecipientSet {
    pub recipient: Pubkey,
    pub portion: u64,
}

#[event]
pub struct TradeOpened {
    pub trade_id: u64,
    pub start_price: u64,
    pub end_price: u64,
    pub start: u64,
    pub end: u64,
}

#[event]
pub struct TradeApproved {
    pub trade_id: u64,
    pub from: Pubkey,
    pub to: Pubkey,
    pub amount: u64,
    pub start_price: u64,
}

#[event]
pub struct TradeKilled {
    pub trade_id: u64,
}

#[event]
pub struct Bid {
    pub trade_id: u64,
    pub sell_amount: u64,
    pub bought_amount: u64,
}

#[event]
pub struct RewardTokenAdded {
    pub reward_token: Pubkey,
}

#[event]
pub struct RewardRatioSet {
    pub reward_ratio: u64,
    pub reward_half_life: u64,
}

#[event]
pub struct RewardTokenRemoved {
    pub reward_token: Pubkey,
}
