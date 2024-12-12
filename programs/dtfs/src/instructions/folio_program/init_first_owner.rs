use crate::check_condition;
use crate::error::ErrorCode;
use crate::state::Actor;
use anchor_lang::prelude::*;
use folio::state::{Folio, FolioProgramSigner};
use folio::ID as FOLIO_ID;

#[derive(Accounts)]
pub struct InitFirstOwner<'info> {
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,

    /// CHECK: Folio owner
    #[account(mut)]
    pub folio_owner: Signer<'info>,

    // To ensure that the program is signed by the folio program
    #[account(
        seeds = [FolioProgramSigner::SEEDS],
        bump = folio_program_signer.bump,
        seeds::program = FOLIO_ID,
        signer
    )]
    pub folio_program_signer: Box<Account<'info, FolioProgramSigner>>,

    #[account(
        init,
        payer = folio_owner,
        space = Actor::SIZE,
        seeds = [Actor::SEEDS, folio_owner.key().as_ref()],
        bump
    )]
    pub actor: Box<Account<'info, Actor>>,

    /// CHECK: Folio
    #[account(
        seeds = [Folio::SEEDS, folio_token_mint.key().as_ref()],
        bump,
        seeds::program = FOLIO_ID,
    )]
    pub folio: AccountInfo<'info>,

    /// CHECK: Folio token mint
    #[account()]
    pub folio_token_mint: AccountInfo<'info>,
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
