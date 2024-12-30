use anchor_lang::prelude::*;
use shared::check_condition;
use shared::constants::common::ADMIN;
use shared::constants::DTF_PROGRAM_SIGNER_SEEDS;
use shared::errors::ErrorCode;

use crate::state::DtfProgramSigner;

#[derive(Accounts)]
pub struct InitDtfSigner<'info> {
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,

    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = DtfProgramSigner::SIZE,
        seeds = [DTF_PROGRAM_SIGNER_SEEDS],
        bump
    )]
    pub dtf_program_signer: Account<'info, DtfProgramSigner>,
}

impl InitDtfSigner<'_> {
    pub fn validate(&self) -> Result<()> {
        check_condition!(self.admin.key() == ADMIN, Unauthorized);

        Ok(())
    }
}

pub fn handler(ctx: Context<InitDtfSigner>) -> Result<()> {
    ctx.accounts.validate()?;

    let dtf_program_signer = &mut ctx.accounts.dtf_program_signer;
    dtf_program_signer.bump = ctx.bumps.dtf_program_signer;

    Ok(())
}
