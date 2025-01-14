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

/// PDA Seeds ["dao_fee_config"]
/// *** DAO FEE REGISTY == PLATFORM FEE REGISTY == COMMUNITY ***
#[account]
#[derive(Default, InitSpace)]
pub struct DAOFeeConfig {
    pub bump: u8,

    pub fee_recipient: Pubkey,
    pub fee_recipient_numerator: u64,
}

impl DAOFeeConfig {
    pub const SIZE: usize = 8 + DAOFeeConfig::INIT_SPACE;
}
