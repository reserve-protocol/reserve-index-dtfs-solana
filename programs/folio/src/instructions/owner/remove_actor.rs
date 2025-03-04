use crate::state::{Actor, Folio};
use crate::utils::structs::Role;
use anchor_lang::prelude::*;
use shared::constants::ACTOR_SEEDS;

/// Remove a role from an actor or closes the actor accouunt completely.
///
/// # Arguments
/// * `system_program` - The system program.
/// * `rent` - The rent sysvar.
/// * `folio_owner` - The folio owner account (mut, signer).
/// * `actor_authority` - The actor authority account (not mut, not signer).
/// * `folio_owner_actor` - The folio owner actor account (PDA) (not mut, not signer).
/// * `actor_to_remove` - The actor to remove the role from or close (mut, not signer).
/// * `folio` - The folio account (PDA) (not mut, not signer).
#[derive(Accounts)]
pub struct RemoveActor<'info> {
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,

    #[account(mut)]
    pub folio_owner: Signer<'info>,

    /// CHECK: Wallet, DAO, multisig
    #[account()]
    pub actor_authority: UncheckedAccount<'info>,

    #[account(
        seeds = [ACTOR_SEEDS, folio_owner.key().as_ref(), folio_owner_actor.folio.key().as_ref()],
        bump = folio_owner_actor.bump,
    )]
    pub folio_owner_actor: Box<Account<'info, Actor>>,

    #[account(mut,
        seeds = [ACTOR_SEEDS, actor_authority.key().as_ref(), folio_owner_actor.folio.key().as_ref()],
        bump = actor_to_remove.bump,
    )]
    pub actor_to_remove: Box<Account<'info, Actor>>,

    #[account()]
    pub folio: AccountLoader<'info, Folio>,
}

impl RemoveActor<'_> {
    /// Validate the instruction.
    ///
    /// # Checks
    /// * Actor is an owner of the folio.
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

/// Remove a role from an actor or closes the actor accouunt completely.
///
/// # Arguments
/// * `ctx` - The context of the instruction.
/// * `role` - The role to remove from the actor.
/// * `close_actor` - Whether to close the actor account completely.
pub fn handler(ctx: Context<RemoveActor>, role: Role, close_actor: bool) -> Result<()> {
    ctx.accounts.validate()?;

    let actor_to_remove = &mut ctx.accounts.actor_to_remove;

    if !close_actor {
        Role::remove_role(&mut actor_to_remove.roles, role);
    } else {
        // To prevent re-init attacks, we reset the actor with default values
        actor_to_remove.reset();

        actor_to_remove.close(ctx.accounts.folio_owner.to_account_info())?;
    }

    Ok(())
}
