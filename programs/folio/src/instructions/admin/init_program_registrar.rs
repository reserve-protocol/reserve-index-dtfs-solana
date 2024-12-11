use crate::error::ErrorCode;
use crate::{check_condition, state::ProgramRegistrar, utils::constants::common::ADMIN};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct InitProgramRegistrar<'info> {
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,

    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = ProgramRegistrar::SIZE,
        seeds = [ProgramRegistrar::SEEDS],
        bump
    )]
    pub program_registrar: Account<'info, ProgramRegistrar>,
}

impl<'info> InitProgramRegistrar<'info> {
    pub fn validate(&self) -> Result<()> {
        check_condition!(self.admin.key() == ADMIN, Unauthorized);

        Ok(())
    }
}

pub fn handler(ctx: Context<InitProgramRegistrar>, program_id: Pubkey) -> Result<()> {
    ctx.accounts.validate()?;

    let program_registrar = &mut ctx.accounts.program_registrar;
    program_registrar.bump = ctx.bumps.program_registrar;
    program_registrar.accepted_programs[0] = program_id;

    Ok(())
}
