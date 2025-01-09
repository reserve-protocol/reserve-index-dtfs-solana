use anchor_lang::prelude::*;
use shared::structs::DecimalValue;

/// PDA Seeds ["dtf_program_signer"]
#[account]
#[derive(Default, InitSpace)]
pub struct DtfProgramSigner {
    pub bump: u8,
}

impl DtfProgramSigner {
    pub const SIZE: usize = 8 + DtfProgramSigner::INIT_SPACE;
}

/// PDA Seeds ["dao_fee_config"]
/// *** DAO FEE REGISTY == PLATFORM FEE REGISTY == COMMUNITY ***
#[account]
#[derive(Default, InitSpace)]
pub struct DAOFeeConfig {
    pub bump: u8,

    pub fee_recipient: Pubkey,
    pub fee_recipient_numerator: DecimalValue,
}

impl DAOFeeConfig {
    pub const SIZE: usize = 8 + DAOFeeConfig::INIT_SPACE;
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
