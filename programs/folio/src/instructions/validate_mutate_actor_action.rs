use crate::{
    events::FolioCreated,
    state::{Folio, FolioProgramSigner},
    DtfProgram,
};
use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_2022::Token2022,
    token_interface::{Mint, TokenAccount},
};
use shared::{
    check_condition,
    constants::{
        ACTOR_SEEDS, DTF_PROGRAM_SIGNER_SEEDS, FOLIO_PROGRAM_SIGNER_SEEDS, FOLIO_SEEDS,
        MAX_FEE_RECIPIENTS, MAX_PLATFORM_FEE, PRECISION_FACTOR, PROGRAM_REGISTRAR_SEEDS,
    },
    structs::{FeeRecipient, Role},
};

use crate::state::ProgramRegistrar;
use shared::errors::ErrorCode;

#[derive(Accounts)]
pub struct ValidateMutateActorAction<'info> {
    #[account(mut)]
    pub folio_owner: Signer<'info>,

    /// CHECK: Actor
    #[account(mut,
        seeds = [ACTOR_SEEDS, folio_owner.key().as_ref(), folio.key().as_ref()],
        bump,
        seeds::program = dtf_program.key()
    )]
    pub actor: AccountInfo<'info>,

    #[account(
        seeds = [PROGRAM_REGISTRAR_SEEDS],
        bump = program_registrar.bump
    )]
    pub program_registrar: Box<Account<'info, ProgramRegistrar>>,

    /// CHECK: Folio
    #[account()]
    pub folio: AccountLoader<'info, Folio>,

    /// CHECK: DTF program used for creating owner record
    #[account()]
    pub dtf_program: UncheckedAccount<'info>,

    #[account(
        seeds = [DTF_PROGRAM_SIGNER_SEEDS],
        bump,
        seeds::program = dtf_program.key(),
    )]
    pub dtf_program_signer: Signer<'info>,

    /// CHECK: DTF program data to validate program deployment slot
    #[account()]
    pub dtf_program_data: UncheckedAccount<'info>,
}

impl<'info> ValidateMutateActorAction<'info> {
    pub fn validate(&self) -> Result<()> {
        let folio = &self.folio.load()?;

        folio.validate_folio_program_post_init(
            &self.program_registrar,
            &self.dtf_program,
            &self.dtf_program_data,
            Some(folio.bump),
            Some(&self.actor),
            Role::Owner,
        )?;

        Ok(())
    }
}

pub fn handler(ctx: Context<ValidateMutateActorAction>) -> Result<()> {
    ctx.accounts.validate()?;

    // No actual action to perform here, just validation that will rollback the transaction if it fails

    Ok(())
}
