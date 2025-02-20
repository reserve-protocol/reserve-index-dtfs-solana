use crate::utils::math_util::Decimal;
use crate::utils::structs::FolioStatus;
use crate::utils::{Rounding, TokenUtil};
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
use shared::{
    check_condition,
    constants::{FOLIO_BASKET_SEEDS, FOLIO_SEEDS},
    errors::ErrorCode,
};

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
    /*
    For the callback it'll happen with the remaining accounts
     */
}

impl Bid<'_> {
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

pub fn handler(
    ctx: Context<Bid>,
    sell_amount: u64,
    max_buy_amount: u64,
    with_callback: bool,
    callback_data: Vec<u8>,
) -> Result<()> {
    let folio = &ctx.accounts.folio.load()?;
    let folio_token_mint_key = &ctx.accounts.folio_token_mint.key();
    let folio_token_mint = &ctx.accounts.folio_token_mint;
    let auction = &mut ctx.accounts.auction.load_mut()?;

    ctx.accounts.validate(folio, auction)?;

    let current_time = Clock::get()?.unix_timestamp as u64;

    let price = Decimal::from_scaled(auction.get_price(current_time)?);

    let bought_amount = Decimal::from_token_amount(sell_amount)?
        .mul(&price)?
        .to_token_amount(Rounding::Floor)?
        .0;

    check_condition!(bought_amount <= max_buy_amount, SlippageExceeded);

    let folio_token_total_supply = folio.get_total_supply(folio_token_mint.supply)?;

    // Sell related logic
    let sell_balance = ctx.accounts.folio_sell_token_account.amount;

    let min_sell_balance = match Decimal::from_scaled(auction.sell_limit.spot)
        .mul(&folio_token_total_supply)?
        .div(&Decimal::ONE_E18)?
        .to_token_amount(Rounding::Ceiling)?
        .0
    {
        min_sell_balance if sell_balance > min_sell_balance => sell_balance - min_sell_balance,
        _ => 0,
    };

    check_condition!(sell_amount <= min_sell_balance, InsufficientBalance);

    let folio_basket = &mut ctx.accounts.folio_basket.load_mut()?;
    folio_basket.add_tokens_to_basket(&vec![auction.buy])?;

    // Transfer to the bidder
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
        sell_amount,
        ctx.accounts.auction_sell_token_mint.decimals,
    )?;

    emit!(AuctionBid {
        auction_id: auction.id,
        sell_amount,
        bought_amount,
    });

    // Check if we sold out all the tokens of the sell mint
    ctx.accounts.folio_sell_token_account.reload()?;
    let sell_balance = ctx.accounts.folio_sell_token_account.amount;
    if sell_balance <= min_sell_balance {
        auction.end = current_time;
        // cannot update sellEnds/buyEnds due to possibility of parallel auctions

        if sell_balance == 0 {
            folio_basket.remove_tokens_from_basket(&vec![auction.sell])?;
        }
    }

    // Check with the callback / collect payment
    if with_callback {
        ctx.accounts.folio_buy_token_account.reload()?; // Reload to make sure

        let folio_buy_balance_before = ctx.accounts.folio_buy_token_account.amount;

        cpi_call(ctx.remaining_accounts, callback_data)?;

        // Validate we received the proper funds
        ctx.accounts.folio_buy_token_account.reload()?;

        check_condition!(
            ctx.accounts
                .folio_buy_token_account
                .amount
                .checked_sub(folio_buy_balance_before)
                .ok_or(ErrorCode::MathOverflow)?
                >= bought_amount,
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
            bought_amount,
            ctx.accounts.auction_buy_token_mint.decimals,
        )?;
    }

    // Validate max buy balance
    let max_buy_balance = Decimal::from_scaled(auction.buy_limit.spot)
        .mul(&folio_token_total_supply)?
        .to_token_amount(Rounding::Floor)?
        .0;

    ctx.accounts.folio_buy_token_account.reload()?;
    check_condition!(
        ctx.accounts.folio_buy_token_account.amount <= max_buy_balance,
        ExcessiveBid
    );

    Ok(())
}
