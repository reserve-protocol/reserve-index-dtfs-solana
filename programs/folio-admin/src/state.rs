use anchor_lang::prelude::*;

/// DAO Fee config tracks the DAO fees that should be applied to each Folio.
/// The DAO fee is the % of the Folio fees that should go to the DAO.
/// Is controlled by the Admin of the protocol.
///
/// (Fee Registry = Platform Fee = Community, all used interchangeably)
///
/// PDA Seeds ["dao_fee_config"]
#[account]
#[derive(Default, InitSpace)]
pub struct DAOFeeConfig {
    pub bump: u8,

    /// The recipient of the fee (this is the owner of the token account and not the token account itself)
    pub fee_recipient: Pubkey,

    /// Scaled in D18
    pub default_fee_numerator: u128,

    /// The fee floor is a lower-bound on what can be charged to Folio users, in case (Scaled in D18)
    /// the Folio has set its own top-level fees too low.
    pub default_fee_floor: u128,
}

impl DAOFeeConfig {
    pub const SIZE: usize = 8 + DAOFeeConfig::INIT_SPACE;
}

/// Folio Fee config tracks the fees that should be applied to a specific Folio.
/// This can be set or not per folio (if not uses the default one in DAOFeeConfig)
/// Is controlled by the Admin of the protocol.
///
/// PDA Seeds ["folio_fee_config", folio pubkey]
#[account]
#[derive(Default, InitSpace)]
pub struct FolioFeeConfig {
    pub bump: u8,

    /// Scaled in D18
    pub fee_numerator: u128,

    /// The fee floor is a lower-bound on what can be charged to Folio users, in case (Scaled in D18)
    /// the Folio has set its own top-level fees too low.
    pub fee_floor: u128,
}

impl FolioFeeConfig {
    pub const SIZE: usize = 8 + FolioFeeConfig::INIT_SPACE;
}

/// Tracks the versions of the Folio program that are allowed to be migrated to.
/// Will contain pubkeys of different versions of the Folio program that have been deployed.
/// Is controlled by the Admin of the protocol.
/// Maximum number of programs that can be registered is 10.
///
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
