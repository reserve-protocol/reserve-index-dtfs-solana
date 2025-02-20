use crate::events::ProgramRegistryUpdate;
use crate::state::ProgramRegistrar;
use anchor_lang::prelude::*;
use shared::check_condition;
use shared::constants::common::ADMIN;
use shared::constants::PROGRAM_REGISTRAR_SEEDS;
use shared::errors::ErrorCode;

/// Update the program registrar.
///
/// # Arguments
/// * `admin` - The admin account (mut, signer).
/// * `program_registrar` - The program registrar account (PDA) (mut, not signer).
#[derive(Accounts)]
pub struct UpdateProgramRegistrar<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [PROGRAM_REGISTRAR_SEEDS],
        bump = program_registrar.bump
    )]
    pub program_registrar: Account<'info, ProgramRegistrar>,
}

impl UpdateProgramRegistrar<'_> {
    /// Validate the instruction.
    ///
    /// # Checks
    /// * Admin account is the authorized admin.
    pub fn validate(&self) -> Result<()> {
        check_condition!(self.admin.key() == ADMIN, Unauthorized);

        Ok(())
    }
}

/// Update the program registrar.
///
/// # Arguments
/// * `ctx` - The context of the instruction.
/// * `program_ids` - The program ids to add or remove from the registrar.
/// * `remove` - Whether to remove the program ids from the registrar or to add them.
pub fn handler(
    ctx: Context<UpdateProgramRegistrar>,
    program_ids: Vec<Pubkey>,
    remove: bool,
) -> Result<()> {
    ctx.accounts.validate()?;

    if remove {
        ctx.accounts
            .program_registrar
            .remove_from_registrar(program_ids.clone())?;
    } else {
        ctx.accounts
            .program_registrar
            .add_to_registrar(&mut program_ids.to_vec())?;
    }

    emit!(ProgramRegistryUpdate {
        program_ids,
        remove,
    });

    Ok(())
}
