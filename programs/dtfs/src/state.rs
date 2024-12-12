use anchor_lang::prelude::*;

/// PDA Seeds ["ftoken_wrapper", ftoken pubkey]
#[account]
#[derive(Default, InitSpace)]
pub struct FTokenWrapper {
    pub bump: u8,
}

impl FTokenWrapper {
    pub const SIZE: usize = 8 + FTokenWrapper::INIT_SPACE;

    pub const SEEDS: &'static [u8] = b"ftoken_wrapper";
}

/// PDA Seeds ["actor", actor pubkey]
#[account]
#[derive(Default, InitSpace)]
pub struct Actor {
    pub bump: u8,

    pub authority: Pubkey,
    // TODO add the rest of the fields
}

impl Actor {
    pub const SIZE: usize = 8 + Actor::INIT_SPACE;

    pub const SEEDS: &'static [u8] = b"actor";
}
