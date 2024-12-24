use crate::state::Actor;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::bpf_loader_upgradeable;
use folio::state::{Folio, FolioProgramSigner};
use folio::ID as FOLIO_ID;
use shared::check_condition;
use shared::constants::{
    ACTOR_SEEDS, DTF_PROGRAM_SIGNER_SEEDS, FOLIO_SEEDS, PROGRAM_REGISTRAR_SEEDS,
};
use shared::errors::ErrorCode;
use shared::structs::{FeeRecipient, Role};

use crate::state::DtfProgramSigner;
use crate::utils::external::folio_program::FolioProgram;
use crate::ID as DTF_PROGRAM_ID;
use anchor_lang::prelude::*;
use folio::state::ProgramRegistrar;

#[derive(Accounts)]
pub struct FinalizeFolio<'info> {
    pub system_program: Program<'info, System>,

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
    pub program_registrar: UncheckedAccount<'info>,
}

impl<'info> FinalizeFolio<'info> {
    pub fn validate(&self) -> Result<()> {
        check_condition!(Role::has_role(self.actor.roles, Role::Owner), Unauthorized);

        Ok(())
    }
}

pub fn handler(ctx: Context<FinalizeFolio>) -> Result<()> {
    ctx.accounts.validate()?;

    FolioProgram::finalize_folio(ctx)?;

    Ok(())
}
