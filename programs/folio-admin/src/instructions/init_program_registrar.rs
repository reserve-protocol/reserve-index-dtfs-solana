use crate::state::ProgramRegistrar;
use anchor_lang::prelude::*;
use shared::check_condition;
use shared::constants::common::ADMIN;
use shared::constants::PROGRAM_REGISTRAR_SEEDS;
use shared::errors::ErrorCode;

/// Initialize the program registrar.
///
/// # Arguments
/// * `system_program` - The system program.
/// * `rent` - The rent sysvar.
/// * `admin` - The admin account (mut, signer).
/// * `program_registrar` - The program registrar account (PDA) (init, not signer).
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
        seeds = [PROGRAM_REGISTRAR_SEEDS],
        bump
    )]
    pub program_registrar: Account<'info, ProgramRegistrar>,
}

impl InitProgramRegistrar<'_> {
    /// Validate the instruction.
    ///
    /// # Checks
    /// * Admin account is the authorized admin.
    pub fn validate(&self) -> Result<()> {
        check_condition!(self.admin.key() == ADMIN, Unauthorized);

        Ok(())
    }
}

/// Initialize the program registrar.
///
/// # Arguments
/// * `ctx` - The context of the instruction.
/// * `program_id` - The program id to add to init the registrar with.
pub fn handler(ctx: Context<InitProgramRegistrar>, program_id: Pubkey) -> Result<()> {
    ctx.accounts.validate()?;

    let program_registrar = &mut ctx.accounts.program_registrar;
    program_registrar.bump = ctx.bumps.program_registrar;
    program_registrar.accepted_programs[0] = program_id;

    Ok(())
}
