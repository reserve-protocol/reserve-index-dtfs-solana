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

/// Approve an auction.
/// Auction Approver only.
///
/// # Arguments
/// * `auction_id` - The id of the auction to approve.
/// * `system_program` - The system program.
/// * `rent` - The rent sysvar.
/// * `auction_approver` - The account that is approving the auction (mut, signer).
/// * `actor` - The actor account (PDA) (not mut, not signer).
/// * `folio` - The folio account (PDA) (mut, not signer).
/// * `auction` - The auction account (PDA) (init, not signer).
/// * `buy_mint` - The buy token mint account.
/// * `sell_mint` - The sell token mint account.
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

    /// The token to buy, from the perspective of the Folio
    #[account()]
    pub buy_mint: Box<InterfaceAccount<'info, Mint>>,

    /// The token to sell, from the perspective of the Folio
    #[account()]
    pub sell_mint: Box<InterfaceAccount<'info, Mint>>,
}

impl ApproveAuction<'_> {
    /// Validate the instruction.
    ///
    /// # Checks
    /// * Folio has the correct status & actor has the correct role.
    /// * Auction id is valid (current auction id + 1 == auction id).
    /// * Buy and sell mints are different.
    /// * Auction approve parameters are valid.
    /// * Buy mint is a supported SPL token (mean it doesn't have any forbidden extensions).
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

/// Approve an auction.
///
/// # Arguments
/// * `ctx` - The context of the instruction.
/// * `auction_id` - The id of the auction to approve.
/// * `sell_limit` - D18{sellTok/share} min ratio of sell token to shares allowed, inclusive
/// * `buy_limit` - D18{buyTok/share} max balance-ratio to shares allowed, exclusive
/// * `prices` - D18{buyTok/sellTok} Price range
/// * `ttl` - How long a auction can exist in an APPROVED state until it can no longer be OPENED
///           (once opened, it always finishes).
///           Must be longer than auctionDelay if intended to be permissionlessly available.
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
