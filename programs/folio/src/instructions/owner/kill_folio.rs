use crate::events::FolioKilled;
use crate::state::{Actor, Folio};
use crate::utils::structs::{FolioStatus, Role};
use anchor_lang::prelude::*;
use shared::constants::ACTOR_SEEDS;

/// Kill Folio
///
/// # Arguments
/// * `system_program` - The system program.
/// * `folio_owner` - The folio owner account (mut, signer).
/// * `actor` - The actor account (PDA) of the Folio owner (not mut, not signer).
/// * `folio` - The folio account (PDA) (mut, not signer).
#[derive(Accounts)]
pub struct KillFolio<'info> {
    pub system_program: Program<'info, System>,

    #[account(mut)]
    pub folio_owner: Signer<'info>,

    #[account(
        seeds = [ACTOR_SEEDS, folio_owner.key().as_ref(), folio.key().as_ref()],
        bump = actor.bump,
    )]
    pub actor: Account<'info, Actor>,

    #[account(mut)]
    pub folio: AccountLoader<'info, Folio>,
}

impl KillFolio<'_> {
    /// Validate the instruction.
    ///
    /// # Checks
    /// * Folio is initialized or initializing.
    /// * Actor is the owner of the folio.
    pub fn validate(&self, folio: &Folio) -> Result<()> {
        folio.validate_folio(
            &self.folio.key(),
            Some(&self.actor),
            Some(vec![Role::Owner]),
            Some(vec![FolioStatus::Initialized, FolioStatus::Initializing]),
        )?;

        Ok(())
    }
}

/// Kill Folio
///
/// # Arguments
/// * `ctx` - The context of the instruction.
pub fn handler(ctx: Context<KillFolio>) -> Result<()> {
    let folio = &mut ctx.accounts.folio.load_mut()?;

    ctx.accounts.validate(folio)?;

    folio.status = FolioStatus::Killed as u8;

    emit!(FolioKilled {});

    Ok(())
}
