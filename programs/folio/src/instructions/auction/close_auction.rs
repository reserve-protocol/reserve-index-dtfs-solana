use crate::utils::structs::{FolioStatus, Role};
use crate::{
    events::AuctionClosed,
    state::{Actor, Auction, Folio},
};
use anchor_lang::prelude::*;
use shared::constants::ACTOR_SEEDS;
use shared::errors::ErrorCode;

/// Close an auction.
/// Auction Approver, Auction Launcher, or Owner.
///
/// # Arguments
/// * `system_program` - The system program.
/// * `auction_actor` - The actor account (mut, signer).
/// * `actor` - The actor account (PDA) (not mut, not signer).
/// * `folio` - The folio account (PDA) (mut, not signer).
/// * `auction` - The auction account (PDA) (mut, not signer).
#[derive(Accounts)]
pub struct CloseAuction<'info> {
    pub system_program: Program<'info, System>,

    #[account(mut)]
    pub auction_actor: Signer<'info>,

    #[account(
        seeds = [ACTOR_SEEDS, auction_actor.key().as_ref(), folio.key().as_ref()],
        bump = actor.bump,
    )]
    pub actor: Account<'info, Actor>,

    #[account(mut)]
    pub folio: AccountLoader<'info, Folio>,

    #[account(mut)]
    pub auction: AccountLoader<'info, Auction>,
}

impl CloseAuction<'_> {
    /// Validate the instruction.
    ///
    /// # Checks
    /// * Folio has the correct status and actor has the correct role.
    /// * Auction is valid.
    pub fn validate(&self, folio: &Folio, auction: &Auction) -> Result<()> {
        folio.validate_folio(
            &self.folio.key(),
            Some(&self.actor),
            Some(vec![
                Role::AuctionApprover,
                Role::AuctionLauncher,
                Role::Owner,
            ]),
            Some(vec![FolioStatus::Initialized, FolioStatus::Initializing]),
        )?;

        auction.validate_auction(&self.auction.key(), &self.folio.key())?;

        Ok(())
    }
}

/// Close an auction.
/// An auction can be closed from anywhere in its lifecycle, and cannot be restarted
///
/// # Arguments
/// * `ctx` - The context of the instruction.
pub fn handler(ctx: Context<CloseAuction>) -> Result<()> {
    let folio = &mut ctx.accounts.folio.load_mut()?;
    let auction = &mut ctx.accounts.auction.load_mut()?;

    ctx.accounts.validate(folio, auction)?;

    let current_time = Clock::get()?.unix_timestamp as u64;

    let index_of_current_running_auction = auction.index_of_last_or_current_auction_run();
    if let Some(index) = index_of_current_running_auction {
        if auction.auction_run_details[index].end > current_time {
            auction.auction_run_details[index].end = current_time
                .checked_sub(1)
                .ok_or(error!(ErrorCode::MathOverflow))?;
        }
    }
    auction.closed_for_reruns = 1;

    emit!(AuctionClosed {
        auction_id: auction.id
    });

    Ok(())
}
