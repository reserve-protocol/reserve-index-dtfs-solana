use crate::utils::structs::FolioStatus;
use crate::{
    events::AuctionOpened,
    state::{Auction, Folio},
};
use anchor_lang::prelude::*;
use shared::check_condition;

use shared::errors::ErrorCode;

#[derive(Accounts)]
pub struct OpenAuctionPermissionless<'info> {
    pub system_program: Program<'info, System>,

    #[account(mut)]
    pub user: Signer<'info>,

    #[account(mut)]
    pub folio: AccountLoader<'info, Folio>,

    #[account(mut)]
    pub auction: AccountLoader<'info, Auction>,
}

impl OpenAuctionPermissionless<'_> {
    pub fn validate(&self, folio: &Folio, auction: &Auction) -> Result<()> {
        folio.validate_folio(
            &self.folio.key(),
            None,
            None,
            Some(vec![FolioStatus::Initialized]),
        )?;

        // Validate auction
        auction.validate_auction(&self.auction.key(), &self.folio.key())?;

        // Only open auction that have not timed out
        check_condition!(
            Clock::get()?.unix_timestamp as u64 >= auction.available_at,
            AuctionCannotBeOpenedPermissionlesslyYet
        );

        Ok(())
    }
}

pub fn handler(ctx: Context<OpenAuctionPermissionless>) -> Result<()> {
    let folio = &mut ctx.accounts.folio.load_mut()?;
    let auction = &mut ctx.accounts.auction.load_mut()?;

    ctx.accounts.validate(folio, auction)?;

    let current_time = Clock::get()?.unix_timestamp as u64;

    auction.open_auction(folio, current_time)?;

    emit!(AuctionOpened {
        auction_id: auction.id,
        start_price: auction.prices.start,
        end_price: auction.prices.end,
        start: auction.start,
        end: auction.end,
    });

    Ok(())
}
