use crate::utils::structs::{FolioStatus, Role};
use crate::{
    events::AuctionOpened,
    state::{Actor, Auction, Folio},
};
use anchor_lang::prelude::*;
use shared::constants::ACTOR_SEEDS;

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
    pub fn validate(
        &self,
        folio: &Folio,
        auction: &Auction,
        sell_limit: u128,
        buy_limit: u128,
        start_price: u128,
        end_price: u128,
    ) -> Result<()> {
        folio.validate_folio(
            &self.folio.key(),
            Some(&self.actor),
            Some(vec![Role::AuctionLauncher]),
            Some(vec![FolioStatus::Initialized]),
        )?;

        // Validate auction
        auction.validate_auction(&self.auction.key(), &self.folio.key())?;

        // Validate parameters
        auction.validate_auction_opening_from_auction_launcher(
            start_price,
            end_price,
            sell_limit,
            buy_limit,
        )?;

        Ok(())
    }
}

pub fn handler(
    ctx: Context<OpenAuction>,
    sell_limit: u128,
    buy_limit: u128,
    start_price: u128,
    end_price: u128,
) -> Result<()> {
    let folio = &mut ctx.accounts.folio.load_mut()?;
    let auction = &mut ctx.accounts.auction.load_mut()?;

    ctx.accounts.validate(
        folio,
        auction,
        sell_limit,
        buy_limit,
        start_price,
        end_price,
    )?;

    auction.sell_limit.spot = sell_limit;
    auction.buy_limit.spot = buy_limit;
    auction.prices.start = start_price;
    auction.prices.end = end_price;

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
