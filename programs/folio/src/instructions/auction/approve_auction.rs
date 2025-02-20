use crate::utils::structs::{BasketRange, FolioStatus, Role};
use crate::utils::{Prices, TokenUtil};
use crate::{
    events::AuctionApproved,
    state::{Actor, Auction, Folio},
};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;
use shared::{
    check_condition,
    constants::{ACTOR_SEEDS, AUCTION_SEEDS},
    errors::ErrorCode,
};

#[derive(Accounts)]
#[instruction(auction_id: u64)]
pub struct ApproveAuction<'info> {
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,

    #[account(mut)]
    pub auction_approver: Signer<'info>,

    #[account(
        seeds = [ACTOR_SEEDS, auction_approver.key().as_ref(), folio.key().as_ref()],
        bump = actor.bump,
    )]
    pub actor: Account<'info, Actor>,

    #[account(mut)]
    pub folio: AccountLoader<'info, Folio>,

    #[account(
        init,
        payer = auction_approver,
        space = Auction::SIZE,
        seeds = [AUCTION_SEEDS, folio.key().as_ref(), auction_id.to_le_bytes().as_ref()],
        bump
    )]
    pub auction: AccountLoader<'info, Auction>,

    #[account()]
    pub buy_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account()]
    pub sell_mint: Box<InterfaceAccount<'info, Mint>>,
}

impl ApproveAuction<'_> {
    pub fn validate(
        &self,
        folio: &Folio,
        auction_id: u64,
        sell_limit: &BasketRange,
        buy_limit: &BasketRange,
        prices: &Prices,
        ttl: u64,
    ) -> Result<()> {
        folio.validate_folio(
            &self.folio.key(),
            Some(&self.actor),
            Some(vec![Role::AuctionApprover]),
            Some(vec![FolioStatus::Initialized]),
        )?;
        check_condition!(folio.current_auction_id + 1 == auction_id, InvalidAuctionId);

        check_condition!(self.buy_mint.key() != self.sell_mint.key(), MintCantBeEqual);

        Auction::validate_auction_approve(sell_limit, buy_limit, prices, ttl)?;

        // Validate that the buy mint is a supported SPL token (can only check mint here, will check token account in the bid)
        check_condition!(
            TokenUtil::is_supported_spl_token(Some(&self.buy_mint.to_account_info()), None)?,
            UnsupportedSPLToken
        );

        Ok(())
    }
}

pub fn handler(
    ctx: Context<ApproveAuction>,
    auction_id: u64,
    sell_limit: BasketRange,
    buy_limit: BasketRange,
    prices: Prices,
    ttl: u64,
) -> Result<()> {
    let folio_key = ctx.accounts.folio.key();
    let folio = &mut ctx.accounts.folio.load_mut()?;

    ctx.accounts
        .validate(folio, auction_id, &sell_limit, &buy_limit, &prices, ttl)?;

    folio.current_auction_id = auction_id;

    let current_time = Clock::get()?.unix_timestamp as u64;

    let auction = &mut ctx.accounts.auction.load_init()?;

    auction.bump = ctx.bumps.auction;
    auction.folio = folio_key;
    auction.id = auction_id;
    auction.sell = ctx.accounts.sell_mint.key();
    auction.buy = ctx.accounts.buy_mint.key();
    auction.sell_limit = sell_limit;
    auction.buy_limit = buy_limit;
    auction.prices.start = prices.start;
    auction.prices.end = prices.end;
    auction.available_at = current_time + folio.auction_delay;
    auction.launch_timeout = current_time + ttl;
    auction.start = 0;
    auction.end = 0;
    auction.k = 0;

    emit!(AuctionApproved {
        auction_id,
        from: ctx.accounts.sell_mint.key(),
        to: ctx.accounts.buy_mint.key(),
        amount: 0,
        start_price: prices.start,
    });

    Ok(())
}
