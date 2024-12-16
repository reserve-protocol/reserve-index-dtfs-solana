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
pub struct UpdateFolio<'info> {
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,

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
    pub dtf_program: AccountInfo<'info>,

    /// CHECK: DTF Program Data
    #[account(
        seeds = [DTF_PROGRAM_ID.as_ref()],
        bump,
        seeds::program = &bpf_loader_upgradeable::id()
    )]
    pub dtf_program_data: AccountInfo<'info>,

    /// CHECK: Folio Program
    #[account(address = FOLIO_ID)]
    pub folio_program: AccountInfo<'info>,

    /// CHECK: Folio
    #[account(mut,
        seeds = [FOLIO_SEEDS, folio_token_mint.key().as_ref()],
        bump,
        seeds::program = FOLIO_ID
    )]
    pub folio: AccountInfo<'info>,

    /// CHECK: Folio Token Mint
    #[account()]
    pub folio_token_mint: AccountInfo<'info>,

    #[account(
        seeds = [PROGRAM_REGISTRAR_SEEDS],
        bump = program_registrar.bump,
        seeds::program = FOLIO_ID
    )]
    pub program_registrar: Account<'info, ProgramRegistrar>,
}

impl<'info> UpdateFolio<'info> {
    pub fn validate(&self) -> Result<()> {
        check_condition!(Role::has_role(self.actor.roles, Role::Owner), Unauthorized);

        Ok(())
    }
}

pub fn handler(
    ctx: Context<UpdateFolio>,
    program_version: Option<Pubkey>,
    program_deployment_slot: Option<u64>,
    fee_per_second: Option<u64>,
    fee_recipients_to_add: Vec<FeeRecipient>,
    fee_recipients_to_remove: Vec<Pubkey>,
) -> Result<()> {
    ctx.accounts.validate()?;

    FolioProgram::update_folio_account(
        ctx,
        program_version,
        program_deployment_slot,
        fee_per_second,
        fee_recipients_to_add,
        fee_recipients_to_remove,
    )?;

    Ok(())
}
