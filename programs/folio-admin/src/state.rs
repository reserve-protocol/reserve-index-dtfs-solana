use anchor_lang::prelude::*;

/// PDA Seeds ["dao_fee_config"]
/// *** DAO FEE REGISTY == PLATFORM FEE REGISTY == COMMUNITY ***
#[account]
#[derive(Default, InitSpace)]
pub struct DAOFeeConfig {
    pub bump: u8,

    pub fee_recipient: Pubkey,
    pub fee_recipient_numerator: u128,
    pub fee_floor: u128,
}

impl DAOFeeConfig {
    pub const SIZE: usize = 8 + DAOFeeConfig::INIT_SPACE;
}

/// PDA Seeds ["program_registrar"]
#[account]
#[derive(Default, InitSpace)]
pub struct ProgramRegistrar {
    pub bump: u8,

    pub accepted_programs: [Pubkey; ProgramRegistrar::MAX_ACCEPTED_PROGRAMS],
}

impl ProgramRegistrar {
    pub const SIZE: usize = 8 + ProgramRegistrar::INIT_SPACE;

    pub const MAX_ACCEPTED_PROGRAMS: usize = 10;
}
