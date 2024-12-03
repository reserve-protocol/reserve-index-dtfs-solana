use crate::error::ErrorCode;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct InitExampleAccount<'info> {
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,

    #[account(mut)]
    pub authority: Signer<'info>,
}

impl<'info> InitExampleAccount<'info> {
    pub fn validate(&self) -> Result<()> {
        Ok(())
    }
}

pub fn handler(ctx: Context<InitExampleAccount>) -> Result<()> {
    ctx.accounts.validate()?;

    Ok(())
}
