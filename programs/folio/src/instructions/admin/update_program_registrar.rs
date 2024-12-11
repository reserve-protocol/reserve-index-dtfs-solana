use crate::error::ErrorCode;
use crate::events::ProgramRegistryUpdate;
use crate::{check_condition, state::ProgramRegistrar, utils::constants::common::ADMIN};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct UpdateProgramRegistrar<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [ProgramRegistrar::SEEDS],
        bump = program_registrar.bump
    )]
    pub program_registrar: Account<'info, ProgramRegistrar>,
}

impl<'info> UpdateProgramRegistrar<'info> {
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
