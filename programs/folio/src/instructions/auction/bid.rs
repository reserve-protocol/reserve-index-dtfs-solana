use crate::state::FolioTokenMetadata;
use crate::utils::structs::FolioStatus;
use crate::utils::FolioTokenAmount;
use crate::{
    cpi_call,
    events::AuctionBid,
    state::{Auction, Folio, FolioBasket},
};
use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked},
};
use shared::constants::FOLIO_TOKEN_METADATA_SEEDS;
use shared::utils::math_util::Decimal;
use shared::utils::{Rounding, TokenUtil};
use shared::{
    check_condition,
    constants::{FOLIO_BASKET_SEEDS, FOLIO_SEEDS},
    errors::ErrorCode,
};

/// Bid on an auction.
/// Permissionsless.
///
/// # Arguments
/// * `system_program` - The system program.
/// * `token_program` - The token program.
/// * `associated_token_program` - The associated token program.
/// * `bidder` - The bidder account (mut, signer).
/// * `folio` - The folio account (PDA) (mut, not signer).
/// * `folio_basket` - The folio basket account (PDA) (mut, not signer).
/// * `folio_token_mint` - The folio token mint account (not mut, not signer).
/// * `auction` - The auction account (PDA) (mut, not signer).
/// * `auction_sell_token_mint` - The auction sell token mint account (not mut, not signer).
/// * `auction_buy_token_mint` - The auction buy token mint account (not mut, not signer).
/// * `folio_sell_token_account` - The folio sell token account (PDA) (mut, not signer).
/// * `folio_buy_token_account` - The folio buy token account (PDA) (mut, not signer).
/// * `bidder_sell_token_account` - The bidder sell token account (PDA) (mut, not signer).
/// * `bidder_buy_token_account` - The bidder buy token account (PDA) (mut, not signer).
/// * `folio_sell_token_metadata` - The folio sell token metadata account (PDA) (mut, not signer).
///
/// * `remaining_accounts` - The remaining accounts will be the accounts required for the "custom" CPI provided by the bidder.
#[derive(Accounts)]
pub struct Bid<'info> {
    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,

    #[account(mut)]
    pub bidder: Signer<'info>,

    #[account(mut)]
    pub folio: AccountLoader<'info, Folio>,

    #[account(mut,
    seeds = [FOLIO_BASKET_SEEDS, folio.key().as_ref()],
    bump
    )]
    pub folio_basket: AccountLoader<'info, FolioBasket>,

    #[account()]
    pub folio_token_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut)]
    pub auction: AccountLoader<'info, Auction>,

    #[account()]
    pub auction_sell_token_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account()]
    pub auction_buy_token_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut,
    associated_token::mint = auction_sell_token_mint,
    associated_token::authority = folio,
    )]
    pub folio_sell_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut,
    associated_token::mint = auction_buy_token_mint,
    associated_token::authority = folio,
    )]
    pub folio_buy_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut,
    associated_token::mint = auction_sell_token_mint,
    associated_token::authority = bidder,
    )]
    pub bidder_sell_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut,
    associated_token::mint = auction_buy_token_mint,
    associated_token::authority = bidder,
    )]
    pub bidder_buy_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = bidder,
        space = FolioTokenMetadata::SIZE,
        seeds = [FOLIO_TOKEN_METADATA_SEEDS, folio.key().as_ref(), auction_sell_token_mint.key().as_ref()],
        bump
    )]
    pub folio_sell_token_metadata: Account<'info, FolioTokenMetadata>,
    /*
    Remaining accounts will be the accounts required for the "custom" CPI provided by the bidder.
     */
}

impl Bid<'_> {
    /// Validate the instruction.
    ///
    /// # Checks
    /// * Folio has the correct status.
    /// * Folio token mint provided is the same as the sell mint on the folio account.
    /// * Auction sell token mint provided is the same as the sell mint on the auction account.
    /// * Auction buy token mint provided is the same as the buy mint on the auction account.
    /// * Buy token is a supported SPL token (mean it doesn't have any forbidden extensions).
    pub fn validate(&self, folio: &Folio, auction: &Auction) -> Result<()> {
        folio.validate_folio(
            &self.folio.key(),
            None,
            None,
            Some(vec![FolioStatus::Initialized]),
        )?;

        check_condition!(
            self.folio_token_mint.key() == folio.folio_token_mint,
            InvalidFolioTokenMint
        );

        check_condition!(
            self.auction_sell_token_mint.key() == auction.sell,
            InvalidAuctionSellTokenMint
        );

        check_condition!(
            self.auction_buy_token_mint.key() == auction.buy,
            InvalidAuctionBuyTokenMint
        );

        // Validate that the buy token is a supported SPL token (only need to check the token account here)
        check_condition!(
            TokenUtil::is_supported_spl_token(
                None,
                Some(&self.bidder_buy_token_account.to_account_info())
            )?,
            UnsupportedSPLToken
        );

        Ok(())
    }
}

/// Bid in an ongoing auction
///   If with_callback is true, caller must provide remaining accounts for the callback as well as data if needed
///   If with_callback is false, caller must have provided an allowance in advance
/// Seller is the folio, buyer is the bidder. So the transfer will be
///     buy mint -> bidder buy token account to folio buy token account
///     sell mint -> folio sell token account to bidder sell token account
///
/// # Arguments
/// * `ctx` - The context of the instruction.
/// * `raw_sell_amount` - The amount of sell tokens to sell (D9) (how much the bidder wants to buy from the folio).
/// * `raw_max_buy_amount` - The maximum amount of buy tokens to buy (D9) (how much the bidder is willing to pay for the sell tokens from the folio).
/// * `with_callback` - Whether there is a provided callback that needs to be called before finishing the transfer.
/// * `callback_data` - The data to pass to the callback.
pub fn handler(
    ctx: Context<Bid>,
    raw_sell_amount: u64,
    raw_max_buy_amount: u64,
    with_callback: bool,
    callback_data: Vec<u8>,
) -> Result<()> {
    let folio = &ctx.accounts.folio.load()?;
    let folio_token_mint_key = &ctx.accounts.folio_token_mint.key();
    let folio_token_mint = &ctx.accounts.folio_token_mint;
    let auction = &mut ctx.accounts.auction.load_mut()?;

    ctx.accounts.validate(folio, auction)?;

    let current_time = Clock::get()?.unix_timestamp as u64;

    let index_of_current_running_auction = auction.index_of_last_or_current_auction_run();
    check_condition!(
        index_of_current_running_auction.is_some(),
        AuctionNotOngoing
    );
    let index_of_current_running_auction = index_of_current_running_auction.unwrap();

    // checks auction is ongoing
    // D18{buyTok/sellTok}
    let scaled_price = Decimal::from_scaled(
        auction.auction_run_details[index_of_current_running_auction].get_price(current_time)?,
    );

    // {buyTok} = {sellTok} * D18{buyTok/sellTok} / D18
    let raw_bought_amount = Decimal::from_token_amount(raw_sell_amount)?
        .mul(&scaled_price)?
        .to_token_amount(Rounding::Floor)?
        .0;

    check_condition!(raw_bought_amount <= raw_max_buy_amount, SlippageExceeded);

    let folio_basket = &mut ctx.accounts.folio_basket.load_mut()?;

    // totalSupply inflates over time due to TVL fee, causing buyLimits/sellLimits to be slightly stale
    let scaled_folio_token_total_supply = folio.get_total_supply(folio_token_mint.supply)?;

    let raw_sell_balance = folio_basket.get_token_amount_in_folio_basket(&auction.sell)?;
    // {sellTok} = D18{sellTok/share} * {share} / D18
    let raw_min_sell_balance = Decimal::from_scaled(
        auction.auction_run_details[index_of_current_running_auction].sell_limit_spot,
    )
    .mul(&scaled_folio_token_total_supply)?
    .div(&Decimal::ONE_E18)?
    .to_token_amount(Rounding::Ceiling)?
    .0;

    let raw_sell_available = match raw_min_sell_balance {
        raw_min_sell_balance if raw_sell_balance > raw_min_sell_balance => {
            raw_sell_balance - raw_min_sell_balance
        }
        _ => 0,
    };

    // ensure auction is large enough to cover bid
    check_condition!(raw_sell_amount <= raw_sell_available, InsufficientBalance);

    // put buy token in basket
    folio_basket.add_tokens_to_basket(&vec![FolioTokenAmount {
        mint: auction.buy,
        amount: raw_bought_amount,
    }])?;

    // pay bidder
    let folio_bump = folio.bump;
    let signer_seeds = &[FOLIO_SEEDS, folio_token_mint_key.as_ref(), &[folio_bump]];

    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.folio_sell_token_account.to_account_info(),
                to: ctx.accounts.bidder_sell_token_account.to_account_info(),
                authority: ctx.accounts.folio.to_account_info(),
                mint: ctx.accounts.auction_sell_token_mint.to_account_info(),
            },
            &[signer_seeds],
        ),
        raw_sell_amount,
        ctx.accounts.auction_sell_token_mint.decimals,
    )?;

    emit!(AuctionBid {
        auction_id: auction.id,
        sell_amount: raw_sell_amount,
        bought_amount: raw_bought_amount,
    });

    ctx.accounts.folio_sell_token_account.reload()?;

    // Remove the sell token from the basket
    folio_basket.remove_tokens_from_basket(&vec![FolioTokenAmount {
        mint: auction.sell,
        amount: raw_sell_amount,
    }])?;

    let dust_limit = ctx.accounts.folio_sell_token_metadata.dust_amount;
    let basket_presence = folio_basket
        .get_token_presence_per_share_in_basket(&auction.sell, &scaled_folio_token_total_supply)?;
    // QoL: close auction if we have reached the sell limit
    if basket_presence <= (raw_min_sell_balance as u128) + dust_limit {
        auction.auction_run_details[index_of_current_running_auction].end = current_time - 1;
        auction.closed_for_reruns = 1;
        // cannot update sellEnds/buyEnds due to possibility of parallel auctions
        if basket_presence <= dust_limit {
            // Remove all amounts from the basket
            // As the basket presence this token is 0 or below the dust limit set.
            folio_basket.remove_all_amounts_from_basket(auction.sell)?;
        }
    }

    // collect payment from bidder
    if with_callback {
        ctx.accounts.folio_buy_token_account.reload()?;

        let raw_folio_buy_balance_before = ctx.accounts.folio_buy_token_account.amount;

        cpi_call(ctx.remaining_accounts, callback_data)?;

        // Validate we received the proper funds
        ctx.accounts.folio_buy_token_account.reload()?;

        check_condition!(
            ctx.accounts
                .folio_buy_token_account
                .amount
                .checked_sub(raw_folio_buy_balance_before)
                .ok_or(ErrorCode::MathOverflow)?
                >= raw_bought_amount,
            InsufficientBid
        );
    } else {
        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.bidder_buy_token_account.to_account_info(),
                    to: ctx.accounts.folio_buy_token_account.to_account_info(),
                    authority: ctx.accounts.bidder.to_account_info(),
                    mint: ctx.accounts.auction_buy_token_mint.to_account_info(),
                },
            ),
            raw_bought_amount,
            ctx.accounts.auction_buy_token_mint.decimals,
        )?;
    }

    //  D18{buyTok/share} = D18{buyTok/share} * {share} / D18
    let raw_max_buy_balance = Decimal::from_scaled(
        auction.auction_run_details[index_of_current_running_auction].buy_limit_spot,
    )
    .mul(&scaled_folio_token_total_supply)?
    .to_token_amount(Rounding::Floor)?
    .0;

    // ensure post-bid buy balance does not exceed max
    ctx.accounts.folio_buy_token_account.reload()?;
    check_condition!(
        ctx.accounts.folio_buy_token_account.amount <= raw_max_buy_balance,
        ExcessiveBid
    );

    Ok(())
}
