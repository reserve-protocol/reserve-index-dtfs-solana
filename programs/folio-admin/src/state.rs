use anchor_lang::prelude::*;

/// PDA Seeds ["dao_fee_config"]
/// *** DAO FEE REGISTY == PLATFORM FEE REGISTY == COMMUNITY ***
#[account]
#[derive(Default, InitSpace)]
pub struct DAOFeeConfig {
    pub bump: u8,

    pub fee_recipient: Pubkey,

    /// Scaled in D18
    pub default_fee_numerator: u128,

    /// Scaled in D18
    pub default_fee_floor: u128,
}

impl DAOFeeConfig {
    pub const SIZE: usize = 8 + DAOFeeConfig::INIT_SPACE;
}

/// PDA Seeds ["folio_fee_config", folio pubkey]
/// This can be set or not per folio (if not uses the default one above)
#[account]
#[derive(Default, InitSpace)]
pub struct FolioFeeConfig {
    pub bump: u8,

    /// Scaled in D18
    pub fee_numerator: u128,

    /// Scaled in D18
    pub fee_floor: u128,
}

impl FolioFeeConfig {
    pub const SIZE: usize = 8 + FolioFeeConfig::INIT_SPACE;
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
