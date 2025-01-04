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

/// PDA Seeds ["trade", folio pubkey, id]
#[account(zero_copy)]
#[derive(Default, InitSpace)]
pub struct Trade {
    pub bump: u8,
    pub _padding: [u8; 7],

    pub id: u64,

    pub folio: Pubkey,

    // Auction related data
    pub sell: Pubkey,
    pub sell_amount: u64,

    pub buy: Pubkey,

    pub start_price: u64,
    pub end_price: u64,

    pub start: u64,
    pub end: u64,

    pub available_at: u64,
    pub launch_timeout: u64,

    pub k_function: u64, // Function that determines the price degradation
}

impl Trade {
    pub const SIZE: usize = 8 + Trade::INIT_SPACE;
}
