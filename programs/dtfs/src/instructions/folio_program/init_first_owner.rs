use crate::state::Actor;
use anchor_lang::prelude::*;
use folio::state::{Folio, FolioProgramSigner};
use folio::ID as FOLIO_ID;
use shared::check_condition;
use shared::constants::{ACTOR_SEEDS, FOLIO_PROGRAM_SIGNER_SEEDS, FOLIO_SEEDS};
use shared::errors::ErrorCode;
use shared::structs::{roles, Role};

#[derive(Accounts)]
pub struct InitFirstOwner<'info> {
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,

    /// CHECK: Folio owner
    #[account(mut)]
    pub folio_owner: Signer<'info>,

    // To ensure that the program is signed by the folio program
    #[account(
        seeds = [FOLIO_PROGRAM_SIGNER_SEEDS],
        bump = folio_program_signer.bump,
        seeds::program = FOLIO_ID,
        signer
    )]
    pub folio_program_signer: Box<Account<'info, FolioProgramSigner>>,

    #[account(
        init,
        payer = folio_owner,
        space = Actor::SIZE,
        seeds = [ACTOR_SEEDS, folio_owner.key().as_ref(), folio.key().as_ref()],
        bump
    )]
    pub actor: Box<Account<'info, Actor>>,

    /// CHECK: Done within the folio program
    #[account()]
    pub folio: UncheckedAccount<'info>,
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
    actor.folio = ctx.accounts.folio.key();
    Role::add_role(&mut actor.roles, Role::Owner);

    Ok(())
}
