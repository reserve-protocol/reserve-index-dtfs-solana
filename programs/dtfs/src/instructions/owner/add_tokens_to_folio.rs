use crate::state::Actor;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::bpf_loader_upgradeable;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::TokenInterface;
use folio::state::{Folio, FolioProgramSigner};
use folio::ID as FOLIO_ID;
use shared::check_condition;
use shared::constants::{
    ACTOR_SEEDS, DTF_PROGRAM_SIGNER_SEEDS, FOLIO_SEEDS, PENDING_TOKEN_AMOUNTS_SEEDS,
    PROGRAM_REGISTRAR_SEEDS,
};
use shared::errors::ErrorCode;
use shared::structs::{FeeRecipient, Role};

use crate::state::DtfProgramSigner;
use crate::utils::external::folio_program::FolioProgram;
use crate::ID as DTF_PROGRAM_ID;
use anchor_lang::prelude::*;
use folio::state::ProgramRegistrar;

#[derive(Accounts)]
pub struct AddTokensToFolio<'info> {
    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,

    #[account(mut)]
    pub folio_owner: Signer<'info>,

    #[account(mut,
        seeds = [ACTOR_SEEDS, folio_owner.key().as_ref(), folio.key().as_ref()],
        bump = actor.bump,
    )]
    pub actor: Box<Account<'info, Actor>>,

    #[account(
        seeds = [DTF_PROGRAM_SIGNER_SEEDS],
        bump = dtf_program_signer.bump
    )]
    pub dtf_program_signer: Account<'info, DtfProgramSigner>,

    /// CHECK: DTF Program
    #[account(address = DTF_PROGRAM_ID)]
    pub dtf_program: UncheckedAccount<'info>,

    /// CHECK: DTF Program Data
    #[account(
        seeds = [DTF_PROGRAM_ID.as_ref()],
        bump,
        seeds::program = &bpf_loader_upgradeable::id()
    )]
    pub dtf_program_data: UncheckedAccount<'info>,

    /// CHECK: Folio Program
    #[account(address = FOLIO_ID)]
    pub folio_program: UncheckedAccount<'info>,

    /// CHECK: Done within the folio program
    #[account(mut)]
    pub folio: UncheckedAccount<'info>,

    /// CHECK: Done within the folio program
    #[account(mut)]
    pub folio_pending_token_amounts: UncheckedAccount<'info>,

    /// CHECK: Done within the folio program
    #[account()]
    pub program_registrar: UncheckedAccount<'info>,
    /*
    The remaining accounts need to match the order of amounts as parameter

    Remaining accounts will have as many as possible of the following (always in the same order):
        - Token Mint (read)
        - Sender Token Account (needs to be owned by owner) (mut)
        - Receiver Token Account (needs to be owned by folio) (this is expected to be the ATA and already exist, to save on compute) (mut)
     */
}

impl<'info> AddTokensToFolio<'info> {
    pub fn validate(&self) -> Result<()> {
        check_condition!(Role::has_role(self.actor.roles, Role::Owner), Unauthorized);

        Ok(())
    }
}

pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, AddTokensToFolio<'info>>,
    amounts: Vec<u64>,
) -> Result<()> {
    ctx.accounts.validate()?;

    FolioProgram::init_tokens_for_folio(ctx, amounts)?;

    Ok(())
}
