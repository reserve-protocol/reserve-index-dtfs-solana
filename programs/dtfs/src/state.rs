use anchor_lang::prelude::*;
use shared::structs::RoleData;

/// PDA Seeds ["dtf_program_signer"]
#[account]
#[derive(Default, InitSpace)]
pub struct DtfProgramSigner {
    pub bump: u8,
}

impl DtfProgramSigner {
    pub const SIZE: usize = 8 + DtfProgramSigner::INIT_SPACE;
}

/// PDA Seeds ["ftoken_wrapper", ftoken pubkey]
#[account]
#[derive(Default, InitSpace)]
pub struct FTokenWrapper {
    pub bump: u8,
}

impl FTokenWrapper {
    pub const SIZE: usize = 8 + FTokenWrapper::INIT_SPACE;
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

    pub role_data: RoleData,
}

impl Actor {
    pub const SIZE: usize = 8 + Actor::INIT_SPACE;
}
