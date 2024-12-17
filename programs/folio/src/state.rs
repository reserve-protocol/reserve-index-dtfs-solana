use anchor_lang::prelude::*;
use shared::{
    constants::MAX_FEE_RECIPIENTS,
    structs::{FeeRecipient, FolioStatus},
};

/// PDA Seeds ["folio_program_signer"]
#[account]
#[derive(Default, InitSpace)]
pub struct FolioProgramSigner {
    pub bump: u8,
}

impl FolioProgramSigner {
    pub const SIZE: usize = 8 + FolioProgramSigner::INIT_SPACE;
}

/// PDA Seeds ["community"]
#[account]
#[derive(Default, InitSpace)]
pub struct Community {
    pub bump: u8,

    pub community_receiver: Pubkey,
}

impl Community {
    pub const SIZE: usize = 8 + Community::INIT_SPACE;
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

    // Can't have an enum because of zero copy, so will use u8 and match it with FolioStatus enum
    pub status: u8,

    // Add padding to ensure 8-byte alignment
    pub _padding: [u8; 30],

    // Represents the program it can interact with
    pub program_version: Pubkey,
    // To also check if the program at the same address was updated (in case of upgrade authority takeover)
    pub program_deployment_slot: u64,

    // The mint of the folio token
    // Circulating supply is stored in the token mint automatically
    pub folio_token_mint: Pubkey,

    pub fee_per_second: u64,

    // Max 64 fee recipients, default pubkey means not set
    pub fee_recipients: [FeeRecipient; MAX_FEE_RECIPIENTS],
}

impl Folio {
    pub const SIZE: usize = 8 + Folio::INIT_SPACE;
}

impl Default for Folio {
    fn default() -> Self {
        Self {
            bump: 0,
            status: FolioStatus::Initializing as u8,
            _padding: [0; 30],
            program_version: Pubkey::default(),
            program_deployment_slot: 0,
            folio_token_mint: Pubkey::default(),
            fee_per_second: 0,
            fee_recipients: [FeeRecipient::default(); MAX_FEE_RECIPIENTS],
        }
    }
}
