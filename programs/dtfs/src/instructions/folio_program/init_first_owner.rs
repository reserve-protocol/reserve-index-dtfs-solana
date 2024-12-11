use crate::error::ErrorCode;
use crate::state::Actor;
use anchor_lang::prelude::*;
use folio::state::{Folio, FolioProgramSigner};
use folio::ID as FOLIO_ID;

#[derive(Accounts)]
pub struct InitFirstOwner<'info> {
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,

    #[account(mut)]
    pub folio_owner: Signer<'info>,

    // To ensure that the program is signed by the folio program
    #[account(mut,
        seeds = [FolioProgramSigner::SEEDS],
        bump = folio_program_signer.bump,
        seeds::program = FOLIO_ID,
        signer
    )]
    pub folio_program_signer: Account<'info, FolioProgramSigner>,

    #[account(
        init,
        payer = folio_owner,
        space = Actor::SIZE,
        seeds = [Actor::SEEDS, actor.key().as_ref()],
        bump
    )]
    pub actor: Account<'info, Actor>,

    #[account(
        seeds = [Folio::SEEDS],
        bump = folio.bump,
        seeds::program = FOLIO_ID
    )]
    pub folio: Account<'info, Folio>,
}

impl<'info> InitFirstOwner<'info> {
    pub fn validate(&self) -> Result<()> {
        Ok(())
    }
}

pub fn handler(ctx: Context<InitFirstOwner>) -> Result<()> {
    ctx.accounts.validate()?;

    let actor = &mut ctx.accounts.actor;
    actor.bump = ctx.bumps.actor;
    actor.authority = ctx.accounts.folio_owner.key();

    Ok(())
}
