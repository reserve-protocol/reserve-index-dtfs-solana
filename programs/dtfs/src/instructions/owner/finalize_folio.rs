use crate::state::Actor;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::bpf_loader_upgradeable;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use folio::ID as FOLIO_ID;
use shared::check_condition;
use shared::constants::{ACTOR_SEEDS, DTF_PROGRAM_SIGNER_SEEDS};
use shared::errors::ErrorCode;
use shared::structs::Role;

use crate::state::DtfProgramSigner;
use crate::utils::external::folio_program::FolioProgram;
use crate::ID as DTF_PROGRAM_ID;

#[derive(Accounts)]
pub struct FinalizeFolio<'info> {
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

    #[account(mut)]
    pub owner_folio_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

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

    #[account(mut)]
    pub folio_token_mint: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: Done within the folio program
    pub program_registrar: UncheckedAccount<'info>,
}

impl FinalizeFolio<'_> {
    pub fn validate(&self) -> Result<()> {
        check_condition!(Role::has_role(self.actor.roles, Role::Owner), Unauthorized);

        Ok(())
    }
}

pub fn handler(ctx: Context<FinalizeFolio>, initial_shares: u64) -> Result<()> {
    ctx.accounts.validate()?;

    FolioProgram::finalize_folio(ctx, initial_shares)?;

    Ok(())
}
