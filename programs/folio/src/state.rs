use anchor_lang::prelude::*;

/// PDA Seeds ["folio_program_signer"]
#[account]
#[derive(Default, InitSpace)]
pub struct FolioProgramSigner {
    pub bump: u8,
}

impl FolioProgramSigner {
    pub const SIZE: usize = 8 + FolioProgramSigner::INIT_SPACE;
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

/*
All numbers for calculations are u64 (up to 18 "decimals")
*/

/// PDA Seeds ["folio", folio token pubkey]
#[account(zero_copy)]
#[derive(InitSpace)]
pub struct Folio {
    pub bump: u8,
    // Add padding to ensure 8-byte alignment
    pub _padding: [u8; 31],

    // Represents the program it can interact with
    pub program_version: Pubkey,
    // To also check if the program at the same address was updated (in case of upgrade authority takeover)
    pub program_deployment_slot: u64,

    // The mint of the folio token
    pub folio_token_mint: Pubkey,

    pub fee_per_second: u64,

    pub circulating_supply: u128,

    // Max 64 fee recipients, default pubkey means not set
    pub fee_recipients: [Pubkey; 64],
}

impl Folio {
    pub const SIZE: usize = 8 + Folio::INIT_SPACE;
}

impl Default for Folio {
    fn default() -> Self {
        Self {
            bump: 0,
            _padding: [0; 31],
            program_version: Pubkey::default(),
            program_deployment_slot: 0,
            folio_token_mint: Pubkey::default(),
            fee_per_second: 0,
            circulating_supply: 0,
            fee_recipients: [Pubkey::default(); 64],
        }
    }
}
