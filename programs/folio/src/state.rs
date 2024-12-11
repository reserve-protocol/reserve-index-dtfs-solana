use anchor_lang::prelude::*;

/// PDA Seeds ["folio_program_signer"]
#[account]
#[derive(Default, InitSpace)]
pub struct FolioProgramSigner {
    pub bump: u8,
}

impl FolioProgramSigner {
    pub const SIZE: usize = FolioProgramSigner::INIT_SPACE;

    pub const SEEDS: &'static [u8] = b"folio_program_signer";
}

/// PDA Seeds ["program_registrar", program pubkey]
#[account]
#[derive(Default, InitSpace)]
pub struct ProgramRegistrar {
    pub bump: u8,

    pub accepted_programs: [Pubkey; ProgramRegistrar::MAX_ACCEPTED_PROGRAMS],
}

impl ProgramRegistrar {
    pub const SIZE: usize = ProgramRegistrar::INIT_SPACE;

    pub const SEEDS: &'static [u8] = b"program_registrar";

    pub const MAX_ACCEPTED_PROGRAMS: usize = 10;
}

/*
All numbers for calculations are u64 (up to 18 "decimals")
*/

/// PDA Seeds ["folio", folio token pubkey]
#[account]
#[derive(InitSpace)]
pub struct Folio {
    pub bump: u8,

    // Represents the program it can interact with
    pub program_version: Pubkey,

    // The mint of the folio token
    pub folio_token_mint: Pubkey,

    pub fee_per_second: u64,

    pub circulating_supply: u128,

    // Max 64 fee recipients, default pubkey means not set
    pub fee_recipient: [Pubkey; 64],
}

impl Folio {
    pub const SIZE: usize = Folio::INIT_SPACE + 50; // 50 padding

    pub const SEEDS: &'static [u8] = b"folio";
}

impl Default for Folio {
    fn default() -> Self {
        Self {
            bump: 0,
            program_version: Pubkey::default(),
            folio_token_mint: Pubkey::default(),
            fee_per_second: 0,
            circulating_supply: 0,
            fee_recipient: [Pubkey::default(); 64],
        }
    }
}
