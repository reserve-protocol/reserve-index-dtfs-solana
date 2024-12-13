use anchor_lang::prelude::*;
use shared::constants::PROGRAM_REGISTRAR_SEEDS;

use crate::state::ProgramRegistrar;

#[derive(Accounts)]
pub struct MintFolioToken<'info> {
    #[account(
        seeds = [PROGRAM_REGISTRAR_SEEDS],
        bump = program_registrar.bump
    )]
    pub program_registrar: Account<'info, ProgramRegistrar>,

    #[account(mut)]
    pub folio_owner: Signer<'info>,
}

impl<'info> MintFolioToken<'info> {
    pub fn validate(&self) -> Result<()> {
        Ok(())
    }
}

pub fn handler(ctx: Context<MintFolioToken>) -> Result<()> {
    ctx.accounts.validate()?;

    Ok(())
}
