use anchor_lang::prelude::*;

/// PDA Seeds ["dtf_program_signer"]
#[account]
#[derive(Default, InitSpace)]
pub struct DtfProgramSigner {
    pub bump: u8,
}

impl DtfProgramSigner {
    pub const SIZE: usize = 8 + DtfProgramSigner::INIT_SPACE;
}

/// PDA Seeds ["actor", auth pubkey, folio pubkey]
#[account]
#[derive(Default, InitSpace)]
pub struct Actor {
    pub bump: u8,

    pub authority: Pubkey,
    pub folio: Pubkey,

    // Will use bitwise operations to check for roles
    pub roles: u8,
}

impl Actor {
    pub const SIZE: usize = 8 + Actor::INIT_SPACE;
}

/// PDA Seeds ["basket_change", auth pubkey, folio pubkey]
#[account(zero_copy)]
#[derive(Default, InitSpace)]
pub struct BasketChange {
    pub bump: u8,
    pub _padding: [u8; 7],

    pub folio: Pubkey,

    pub trade_approver: Pubkey,
    pub price_curator: Pubkey,

    // Auction related data
    pub sell_token_mint: Pubkey,
    pub sell_token_amount: u64,

    pub buy_token_mint: Pubkey,

    pub start_price: u64,
    pub end_price: u64,

    pub start_time: u64,
    pub auction_duration: u64,

    pub amount_sold: u64,

    pub launch_timeout: u64,
    pub available_at: u64,
    pub k_function: u64, // Function that determines the price degradation
}
