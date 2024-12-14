use anchor_lang::prelude::*;
use shared::constants::PROGRAM_REGISTRAR_SEEDS;

use crate::state::ProgramRegistrar;

#[derive(Accounts)]
pub struct UpdateFolio<'info> {
    #[account(
        seeds = [PROGRAM_REGISTRAR_SEEDS],
        bump = program_registrar.bump
    )]
    pub program_registrar: Account<'info, ProgramRegistrar>,

    #[account(mut)]
    pub folio_owner: Signer<'info>,
}

impl<'info> UpdateFolio<'info> {
    pub fn validate(&self) -> Result<()> {
        Ok(())
    }
}

pub fn handler(ctx: Context<UpdateFolio>) -> Result<()> {
    ctx.accounts.validate()?;

    Ok(())
}
