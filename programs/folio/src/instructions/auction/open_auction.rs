use crate::utils::structs::{FolioStatus, Role};
use crate::utils::{OpenAuctionConfig, Prices};
use crate::{
    events::AuctionOpened,
    state::{Actor, Auction, Folio},
};
use anchor_lang::prelude::*;
use shared::constants::ACTOR_SEEDS;

/// Open an auction
/// Auction Launcher only.
///
/// # Arguments
/// * `system_program` - The system program.
/// * `auction_launcher` - The auction launcher account (mut, signer).
/// * `actor` - The actor account (PDA) (not mut, not signer).
/// * `folio` - The folio account (PDA) (mut, not signer).
/// * `auction` - The auction account (PDA) (mut, not signer).
#[derive(Accounts)]
pub struct OpenAuction<'info> {
    pub system_program: Program<'info, System>,

    #[account(mut)]
    pub auction_launcher: Signer<'info>,

    #[account(
        seeds = [ACTOR_SEEDS, auction_launcher.key().as_ref(), folio.key().as_ref()],
        bump = actor.bump,
    )]
    pub actor: Account<'info, Actor>,

    #[account(mut)]
    pub folio: AccountLoader<'info, Folio>,

    #[account(mut)]
    pub auction: AccountLoader<'info, Auction>,
}

impl OpenAuction<'_> {
    /// Validate the instruction.
    ///
    /// # Checks
    /// * Folio has the correct status and actor has the correct role.
    /// * Auction is valid.
    /// * Auction parameters are valid.
    pub fn validate(&self, folio: &Folio, auction: &Auction) -> Result<()> {
        folio.validate_folio(
            &self.folio.key(),
            Some(&self.actor),
            Some(vec![Role::AuctionLauncher]),
            Some(vec![FolioStatus::Initialized]),
        )?;

        // Validate auction
        auction.validate_auction(&self.auction.key(), &self.folio.key())?;

        Ok(())
    }
}

/// Open an auction
///
/// # Arguments
/// * `ctx` - The context of the instruction.
/// * `scaled_sell_limit` - D18{sellTok/share} min ratio of sell token to shares allowed, inclusive
/// * `scaled_buy_limit` - D18{buyTok/share} max balance-ratio to shares allowed, exclusive
/// * `scaled_start_price` - D18{buyTok/sellTok} Price range
/// * `scaled_end_price` - D18{buyTok/sellTok} Price range
pub fn handler(
    ctx: Context<OpenAuction>,
    scaled_sell_limit: u128,
    scaled_buy_limit: u128,
    scaled_start_price: u128,
    scaled_end_price: u128,
) -> Result<()> {
    // auction launcher can:
    //   - select a sell limit within the approved range
    //   - select a buy limit within the approved range
    //   - raise starting price by up to 100x
    //   - raise ending price arbitrarily (can cause auction not to clear, same as closing auction)

    let folio = &mut ctx.accounts.folio.load_mut()?;
    let auction = &mut ctx.accounts.auction.load_mut()?;

    ctx.accounts.validate(folio, auction)?;

    let current_time = Clock::get()?.unix_timestamp as u64;

    // Input is also validate in open_auction.
    let auction_run_index = auction.open_auction(
        folio,
        current_time,
        Some(OpenAuctionConfig {
            price: Prices {
                start: scaled_start_price,
                end: scaled_end_price,
            },
            sell_limit_spot: scaled_sell_limit,
            buy_limit_spot: scaled_buy_limit,
        }),
    )?;

    let auction_run_details = auction.auction_run_details[auction_run_index];

    emit!(AuctionOpened {
        auction_id: auction.id,
        start_price: auction_run_details.prices.start,
        end_price: auction_run_details.prices.end,
        start: auction_run_details.start,
        end: auction_run_details.end,
        auction_run_index: auction_run_index as u8
    });

    Ok(())
}
