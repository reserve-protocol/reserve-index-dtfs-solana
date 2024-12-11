use crate::error::ErrorCode;
use crate::state::FolioProgramSigner;
use crate::{check_condition, utils::constants::common::ADMIN};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct InitFolioSigner<'info> {
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,

    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = FolioProgramSigner::SIZE,
        seeds = [FolioProgramSigner::SEEDS],
        bump
    )]
    pub folio_program_signer: Account<'info, FolioProgramSigner>,
}

impl<'info> InitFolioSigner<'info> {
    pub fn validate(&self) -> Result<()> {
        check_condition!(self.admin.key() == ADMIN, Unauthorized);

        Ok(())
    }
}

pub fn handler(ctx: Context<InitFolioSigner>) -> Result<()> {
    ctx.accounts.validate()?;

    let folio_program_signer = &mut ctx.accounts.folio_program_signer;
    folio_program_signer.bump = ctx.bumps.folio_program_signer;

    Ok(())
}
