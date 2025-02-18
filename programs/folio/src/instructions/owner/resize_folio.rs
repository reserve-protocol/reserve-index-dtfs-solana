use crate::state::{Actor, Folio};
use crate::utils::structs::Role;
use anchor_lang::prelude::*;
use shared::constants::ACTOR_SEEDS;

#[derive(Accounts)]
#[instruction(new_size: u64)]
pub struct ResizeFolio<'info> {
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,

    #[account(mut)]
    pub folio_owner: Signer<'info>,

    #[account(
        seeds = [ACTOR_SEEDS, folio_owner.key().as_ref(), folio.key().as_ref()],
        bump = actor.bump,
    )]
    pub actor: Account<'info, Actor>,

    #[account(
        mut,
        realloc = new_size as usize,
        realloc::payer = folio_owner,
        realloc::zero = false
    )]
    pub folio: AccountLoader<'info, Folio>,
}

impl ResizeFolio<'_> {
    pub fn validate(&self) -> Result<()> {
        let folio = self.folio.load()?;
        folio.validate_folio(
            &self.folio.key(),
            Some(&self.actor),
            Some(vec![Role::Owner]),
            None, // Can resize no matter the status
        )?;

        Ok(())
    }
}

pub fn handler(ctx: Context<ResizeFolio>, _new_size: u64) -> Result<()> {
    ctx.accounts.validate()?;

    Ok(())
}
