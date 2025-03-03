use crate::state::{Actor, Folio};
use crate::utils::structs::Role;
use anchor_lang::prelude::*;
use shared::constants::ACTOR_SEEDS;

/// Resize Folio's account size on chain.
///
/// # Arguments
/// * `new_size` - The new size of the folio account.
/// * `system_program` - The system program.
/// * `rent` - The rent sysvar.
/// * `folio_owner` - The folio owner account (mut, signer).
/// * `actor` - The actor account (PDA) of the Folio owner (not mut, not signer).
/// * `folio` - The folio account (PDA) (mut, not signer).
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
    /// Validate the instruction.
    ///
    /// # Checks
    /// * Actor is the owner of the folio.
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

/// Resize Folio's account size on chain.
///
/// # Arguments
/// * `ctx` - The context of the instruction.
/// * `new_size` - The new size of the folio account.
pub fn handler(ctx: Context<ResizeFolio>, _new_size: u64) -> Result<()> {
    ctx.accounts.validate()?;

    Ok(())
}
