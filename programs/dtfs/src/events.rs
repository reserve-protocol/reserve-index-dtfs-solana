use anchor_lang::prelude::*;

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
pub struct Bid {
    pub trade_id: u64,
    pub sell_amount: u64,
    pub buy_amount: u64,
}
