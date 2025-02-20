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
        scaled_sell_limit: u128,
        scaled_buy_limit: u128,
        scaled_start_price: u128,
        scaled_end_price: u128,
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
            scaled_start_price,
            scaled_end_price,
            scaled_sell_limit,
            scaled_buy_limit,
        )?;

        Ok(())
    }
}

pub fn handler(
    ctx: Context<OpenAuction>,
    scaled_sell_limit: u128,
    scaled_buy_limit: u128,
    scaled_start_price: u128,
    scaled_end_price: u128,
) -> Result<()> {
    let folio = &mut ctx.accounts.folio.load_mut()?;
    let auction = &mut ctx.accounts.auction.load_mut()?;

    ctx.accounts.validate(
        folio,
        auction,
        scaled_sell_limit,
        scaled_buy_limit,
        scaled_start_price,
        scaled_end_price,
    )?;

    auction.sell_limit.spot = scaled_sell_limit;
    auction.buy_limit.spot = scaled_buy_limit;
    auction.prices.start = scaled_start_price;
    auction.prices.end = scaled_end_price;

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
