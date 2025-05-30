use crate::state::{Actor, Folio};
use crate::utils::structs::Role;
use anchor_lang::prelude::*;
use shared::constants::ACTOR_SEEDS;

/// Initialize or Update Actor
///
/// # Arguments
/// * `system_program` - The system program.
/// * `rent` - The rent sysvar.
/// * `folio_owner` - The folio owner account (mut, signer).
/// * `folio_owner_actor` - The folio owner actor account (PDA) (not mut, not signer).
/// * `new_actor_authority` - The new actor authority account (not mut, not signer).
/// * `new_actor` - The new actor account (PDA) for the new actor authority (init, not signer).
/// * `folio` - The folio account (PDA) (not mut, not signer).
#[derive(Accounts)]
pub struct InitOrUpdateActor<'info> {
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,

    #[account(mut)]
    pub folio_owner: Signer<'info>,

    #[account(
        seeds = [ACTOR_SEEDS, folio_owner.key().as_ref(), folio_owner_actor.folio.key().as_ref()],
        bump = folio_owner_actor.bump,
    )]
    pub folio_owner_actor: Box<Account<'info, Actor>>,

    /// CHECK: Wallet, DAO, multisig that will be the new actor
    #[account()]
    pub new_actor_authority: UncheckedAccount<'info>,

    /*
    Init if needed because we use the same functionality to add roles to the actor
     */
    #[account(init_if_needed,
        payer = folio_owner,
        space = Actor::SIZE,
        seeds = [ACTOR_SEEDS, new_actor_authority.key().as_ref(), folio_owner_actor.folio.key().as_ref()],
        bump
    )]
    pub new_actor: Box<Account<'info, Actor>>,

    #[account()]
    pub folio: AccountLoader<'info, Folio>,
}

impl InitOrUpdateActor<'_> {
    /// Validate the instruction.
    ///
    /// # Checks
    /// * Folio owner actor is an owner of the folio.
    pub fn validate(&self) -> Result<()> {
        let folio = &self.folio.load()?;

        folio.validate_folio(
            &self.folio.key(),
            Some(&self.folio_owner_actor),
            Some(vec![Role::Owner]),
            None, // Can CRUD actors no matter the status
        )?;

        Ok(())
    }
}

/// Initialize or Update Actor
///
/// # Arguments
/// * `ctx` - The context of the instruction.
/// * `role` - The role to add or give to the actor.
pub fn handler(ctx: Context<InitOrUpdateActor>, role: Role) -> Result<()> {
    ctx.accounts.validate()?;

    let new_actor = &mut ctx.accounts.new_actor;

    let new_actor_bump = new_actor.bump;

    new_actor.process_init_if_needed(
        new_actor_bump,
        ctx.bumps.new_actor,
        &ctx.accounts.new_actor_authority.key(),
        &ctx.accounts.folio_owner_actor.folio,
    )?;

    Role::add_role(&mut new_actor.roles, role);

    Ok(())
}
