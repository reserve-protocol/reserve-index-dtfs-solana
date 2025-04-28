use crate::events::RebalanceStarted;
use crate::state::Rebalance;
use crate::state::{Actor, Folio};
use crate::utils::structs::{FolioStatus, Role};
use crate::utils::RebalancePriceAndLimits;
use anchor_lang::prelude::*;
use shared::constants::REBALANCE_SEEDS;
use shared::utils::TokenUtil;
use shared::{check_condition, constants::ACTOR_SEEDS, errors::ErrorCode};

/// Add rebalance details. This instruction allows for the rebalance manager to add more tokens to be rebalanced.
/// Rebalance Manager only.
///
/// # Arguments
/// * `system_program` - The system program.
/// * `rebalance_manager` - The account that is approving the auction (mut, signer).
/// * `actor` - The actor account (PDA) (not mut, not signer).
/// * `folio` - The folio account (PDA) (mut, not signer).
/// * `rebalance` - The rebalance account (PDA) (init, not signer).
/// * remaining account tokens:
///  - token mints for rebalance
#[derive(Accounts)]
#[instruction()]
pub struct AddRebalanceDetails<'info> {
    pub system_program: Program<'info, System>,

    #[account(mut)]
    pub rebalance_manager: Signer<'info>,

    #[account(
        seeds = [ACTOR_SEEDS, rebalance_manager.key().as_ref(), folio.key().as_ref()],
        bump = actor.bump,
    )]
    pub actor: Account<'info, Actor>,

    #[account(mut)]
    pub folio: AccountLoader<'info, Folio>,

    #[account(
        mut,
        seeds = [REBALANCE_SEEDS, folio.key().as_ref()],
        bump = rebalance.load()?.bump,
    )]
    pub rebalance: AccountLoader<'info, Rebalance>,
    // remaining accounts:
    // - token mints for rebalance
}

impl AddRebalanceDetails<'_> {
    /// Validate the instruction.
    ///
    /// # Checks
    /// * Folio has the correct status & actor has the correct role.
    /// * All mints are supported SPL tokens.
    pub fn validate(&self, folio: &Folio, mints: &[AccountInfo]) -> Result<()> {
        folio.validate_folio(
            &self.folio.key(),
            Some(&self.actor),
            Some(vec![Role::RebalanceManager]),
            Some(vec![FolioStatus::Initialized]),
        )?;

        for mint in mints {
            // Validate that the buy mint is a supported SPL token (can only check mint here, will check token account in the bid)
            check_condition!(
                TokenUtil::is_supported_spl_token(Some(mint), None)?,
                UnsupportedSPLToken
            );
        }

        Ok(())
    }
}

/// Approve an auction.
///
/// # Arguments
/// * `ctx` - The context of the instruction.
pub fn handler(
    ctx: Context<AddRebalanceDetails>,
    prices_and_limits: Vec<RebalancePriceAndLimits>,
    all_rebalance_details_added: bool,
) -> Result<()> {
    let folio = &ctx.accounts.folio.load()?;
    let mints = ctx.remaining_accounts;

    let rebalance = &mut ctx.accounts.rebalance.load_mut()?;

    ctx.accounts.validate(folio, mints)?;

    rebalance.add_rebalance_details(mints, prices_and_limits, all_rebalance_details_added)?;

    if all_rebalance_details_added {
        emit!(RebalanceStarted {
            nonce: rebalance.nonce,
            folio: rebalance.folio,
            started_at: rebalance.started_at,
            restricted_until: rebalance.restricted_until,
            available_until: rebalance.restricted_until,
            details: rebalance.details
        });
    }

    Ok(())
}
