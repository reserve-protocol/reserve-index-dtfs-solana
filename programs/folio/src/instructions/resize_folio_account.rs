use anchor_lang::prelude::*;

use crate::state::ProgramRegistrar;

#[derive(Accounts)]
pub struct ResizeFolioAccount<'info> {
    #[account(
        seeds = [ProgramRegistrar::SEEDS],
        bump = program_registrar.bump
    )]
    pub program_registrar: Account<'info, ProgramRegistrar>,

    #[account(mut)]
    pub folio_owner: Signer<'info>,
}

impl<'info> ResizeFolioAccount<'info> {
    pub fn validate(&self) -> Result<()> {
        Ok(())
    }
}

pub fn handler(ctx: Context<ResizeFolioAccount>) -> Result<()> {
    ctx.accounts.validate()?;

    Ok(())
}
