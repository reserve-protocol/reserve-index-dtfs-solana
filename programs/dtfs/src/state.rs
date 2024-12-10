use anchor_lang::prelude::*;

/// PDA Seeds ["ftoken_wrapper", ftoken pubkey]
#[account]
#[derive(Default)]
pub struct FTokenWrapper {
    pub bump: u8,
}

impl FTokenWrapper {
    pub const SIZE: usize = 8 + 1;

    pub const SEEDS: &'static [u8] = b"ftoken_wrapper";
}
