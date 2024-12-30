use crate::events::ProgramRegistryUpdate;
use crate::state::ProgramRegistrar;
use anchor_lang::prelude::*;
use shared::check_condition;
use shared::constants::common::ADMIN;
use shared::constants::PROGRAM_REGISTRAR_SEEDS;
use shared::errors::ErrorCode;

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
    pub fn validate(&self) -> Result<()> {
        check_condition!(self.admin.key() == ADMIN, Unauthorized);

        Ok(())
    }
}

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
