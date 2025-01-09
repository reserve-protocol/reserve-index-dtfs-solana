use anchor_lang::prelude::*;
use shared::{
    constants::{MAX_FEE_RECIPIENTS, MAX_TOKEN_AMOUNTS},
    structs::{FeeRecipient, TokenAmount},
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

/// PDA Seeds ["actor", auth pubkey, folio pubkey]
#[account]
#[derive(Default, InitSpace)]
pub struct Actor {
    pub bump: u8,

    pub authority: Pubkey,
    pub folio: Pubkey,

    // Will use bitwise operations to check for roles
    pub roles: u8,
}

impl Actor {
    pub const SIZE: usize = 8 + Actor::INIT_SPACE;
}

/*
All numbers for calculations are u64 (up to 9 "decimals")
*/

/// PDA Seeds ["folio", folio token pubkey]
#[account(zero_copy)]
#[derive(Default, InitSpace)]
pub struct Folio {
    pub bump: u8,

    pub status: u8,

    pub _padding: [u8; 30],

    // Represents the program it can interact with
    pub program_version: Pubkey,

    // To also check if the program at the same address was updated (in case of upgrade authority takeover)
    pub program_deployment_slot: u64,

    // The mint of the folio token (Circulating supply is stored in the token mint automatically)
    pub folio_token_mint: Pubkey,

    /*
    Fee related properties
     */
    pub folio_fee: u64,
    pub minting_fee: u64,
    pub last_poke: i64,
    pub dao_pending_fee_shares: u64,
    pub fee_recipients_pending_fee_shares: u64,

    /*
    Trade related properties
     */
    pub trade_delay: u64,
    pub auction_length: u64,
}

impl Folio {
    pub const SIZE: usize = 8 + Folio::INIT_SPACE;
}

/// PDA Seeds ["fee_recipients", folio pubkey]
#[account(zero_copy)]
#[derive(InitSpace)]
pub struct FeeRecipients {
    pub bump: u8,
    pub _padding: [u8; 7],

    pub folio: Pubkey,

    // Max 64 fee recipients, default pubkey means not set
    pub fee_recipients: [FeeRecipient; MAX_FEE_RECIPIENTS],
}

impl FeeRecipients {
    pub const SIZE: usize = 8 + FeeRecipients::INIT_SPACE;
}

impl Default for FeeRecipients {
    fn default() -> Self {
        Self {
            bump: 0,
            _padding: [0; 7],
            folio: Pubkey::default(),
            fee_recipients: [FeeRecipient::default(); MAX_FEE_RECIPIENTS],
        }
    }
}

/*
This is use to track the current user's "pending" token amounts, like when he's minting
or burning and needs to do it in multiple steps.

It's also used to tracked the "frozen" token amounts in the folio, like when a user is minting, so that
those tokens aren't taken into account. It also will represent which tokens are in the folio (authorized tokens).
*/

/// PDA Seeds ["pending_basket", folio] for the folio's pending token amounts
/// PDA Seeds ["pending_basket", folio, wallet] for the wallet's pending token amounts
#[account(zero_copy)]
#[derive(InitSpace)]
pub struct PendingBasket {
    pub bump: u8,

    pub _padding: [u8; 7],

    /// User's wallet pubkey or folio pubkey
    pub owner: Pubkey,

    /// Folio's pubkey
    pub folio: Pubkey,

    // Default pubkey means not set
    pub token_amounts: [TokenAmount; MAX_TOKEN_AMOUNTS],
}

impl PendingBasket {
    pub const SIZE: usize = 8 + PendingBasket::INIT_SPACE;
}

impl Default for PendingBasket {
    fn default() -> Self {
        Self {
            bump: 0,
            _padding: [0; 7],
            owner: Pubkey::default(),
            folio: Pubkey::default(),
            token_amounts: [TokenAmount::default(); MAX_TOKEN_AMOUNTS],
        }
    }
}
