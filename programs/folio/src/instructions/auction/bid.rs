use crate::state::{AuctionEnds, Rebalance};
use crate::utils::structs::FolioStatus;
use crate::utils::{AuctionStatus, FolioTokenAmount};
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
use folio_admin::state::DAOFeeConfig;
use folio_admin::ID as FOLIO_ADMIN_PROGRAM_ID;
use shared::constants::REBALANCE_SEEDS;
use shared::utils::TokenUtil;
use shared::{
    check_condition,
    constants::{DAO_FEE_CONFIG_SEEDS, FOLIO_BASKET_SEEDS, FOLIO_FEE_CONFIG_SEEDS, FOLIO_SEEDS},
    errors::ErrorCode,
};

/// Bid on an auction.
/// Permissionsless.
///
/// # Arguments
/// * `system_program` - The system program.
/// * `buy_token_program` - The buy token program.
/// * `sell_token_program` - The sell token program.
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
    pub buy_token_program: Interface<'info, TokenInterface>,
    pub sell_token_program: Interface<'info, TokenInterface>,
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
    associated_token::token_program = sell_token_program,
    )]
    pub folio_sell_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut,
    associated_token::mint = auction_buy_token_mint,
    associated_token::authority = folio,
    associated_token::token_program = buy_token_program,
    )]
    pub folio_buy_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut,
    associated_token::mint = auction_sell_token_mint,
    associated_token::authority = bidder,
    associated_token::token_program = sell_token_program,
    )]
    pub bidder_sell_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut,
    associated_token::mint = auction_buy_token_mint,
    associated_token::authority = bidder,
    associated_token::token_program = buy_token_program,
    )]
    pub bidder_buy_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        seeds = [REBALANCE_SEEDS, folio.key().as_ref()],
        bump = rebalance.load()?.bump,
    )]
    pub rebalance: AccountLoader<'info, Rebalance>,

    #[account(mut)]
    pub auction_ends: Account<'info, AuctionEnds>,

    #[account(
        seeds = [DAO_FEE_CONFIG_SEEDS],
        bump,
        seeds::program = FOLIO_ADMIN_PROGRAM_ID,
    )]
    pub dao_fee_config: Account<'info, DAOFeeConfig>,

    /// CHECK: Could be empty or could be set, if set we use that one, else we use dao fee config
    #[account(
        seeds = [FOLIO_FEE_CONFIG_SEEDS, folio.key().as_ref()],
        bump,
        seeds::program = FOLIO_ADMIN_PROGRAM_ID,
    )]
    pub folio_fee_config: UncheckedAccount<'info>,
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
    /// * Validate auction ends account.
    /// * Validate rebalance nonce.
    pub fn validate(
        &self,
        folio: &Folio,
        current_time: u64,
        auction: &Auction,
        rebalance: &Rebalance,
    ) -> Result<()> {
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
            self.auction_sell_token_mint.key() == auction.sell_mint,
            InvalidAuctionSellTokenMint
        );

        check_condition!(
            self.auction_buy_token_mint.key() == auction.buy_mint,
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

        self.auction_ends.validate_auction_ends(
            &self.auction_ends.key(),
            auction,
            &self.folio.key(),
        )?;

        check_condition!(
            rebalance.nonce == self.auction_ends.rebalance_nonce,
            InvalidRebalanceNonceAuctionEnded
        );
        check_condition!(
            rebalance.nonce == auction.nonce,
            InvalidRebalanceNonceAuctionEnded
        );

        let auction_status = auction.try_get_status(current_time);

        check_condition!(
            auction_status == Some(AuctionStatus::Open),
            AuctionNotOngoing
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
/// * `raw_sell_amount` - The amount of sell tokens to sell (how much the bidder wants to buy from the folio).
/// * `raw_max_buy_amount` - The maximum amount of buy tokens to buy (how much the bidder is willing to pay for the sell tokens from the folio).
/// * `with_callback` - Whether there is a provided callback that needs to be called before finishing the transfer.
/// * `callback_data` - The data to pass to the callback.
pub fn handler(
    ctx: Context<Bid>,
    raw_sell_amount: u64,
    raw_max_buy_amount: u64,
    with_callback: bool,
    callback_data: Vec<u8>,
) -> Result<()> {
    let folio_token_mint_key = &ctx.accounts.folio_token_mint.key();
    let auction = &mut ctx.accounts.auction.load_mut()?;
    let rebalance = &mut ctx.accounts.rebalance.load()?;
    let folio_basket = &mut ctx.accounts.folio_basket.load_mut()?;
    let current_time = Clock::get()?.unix_timestamp;
    let raw_folio_token_supply = ctx.accounts.folio_token_mint.supply;

    let folio_bump: u8;

    let (raw_sell_amount, raw_bought_amount, _price, scaled_folio_token_total_supply) = {
        let folio = &mut ctx.accounts.folio.load_mut()?;
        // checks auction is ongoing
        ctx.accounts
            .validate(folio, current_time as u64, auction, rebalance)?;

        // Poke folio
        let fee_details = ctx
            .accounts
            .dao_fee_config
            .get_fee_details(&ctx.accounts.folio_fee_config)?;

        folio.poke(
            ctx.accounts.folio_token_mint.supply,
            current_time,
            fee_details.scaled_fee_numerator,
            fee_details.scaled_fee_denominator,
            fee_details.scaled_fee_floor,
        )?;
        folio_bump = folio.bump;

        auction.get_bid(
            folio,
            folio_basket,
            raw_folio_token_supply,
            current_time as u64,
            raw_sell_amount,
            raw_max_buy_amount,
        )?
    };

    // Virtual transfer of sell token from basket to bidder
    folio_basket.remove_tokens_from_basket(&vec![FolioTokenAmount {
        mint: auction.sell_mint,
        amount: raw_sell_amount,
    }])?;
    let sell_basket_presence: u128;
    {
        let sell_balance = folio_basket.get_token_amount_in_folio_basket(&auction.sell_mint)?;
        // remove sell token from basket at 0 balance
        if sell_balance == 0 {
            folio_basket.remove_token_mint_from_basket(auction.sell_mint)?;
        }

        sell_basket_presence = folio_basket.get_token_presence_per_share_in_basket(
            &auction.sell_mint,
            &scaled_folio_token_total_supply,
        )?;

        check_condition!(
            sell_basket_presence >= auction.sell_limit,
            BidInvariantViolated
        );
    }

    // pay bidder
    let signer_seeds = &[FOLIO_SEEDS, folio_token_mint_key.as_ref(), &[folio_bump]];

    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.sell_token_program.to_account_info(),
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
                ctx.accounts.buy_token_program.to_account_info(),
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

    // Virtual transfer of buy token from bidder to basket
    folio_basket.add_tokens_to_basket(&vec![FolioTokenAmount {
        mint: auction.buy_mint,
        amount: raw_bought_amount,
    }])?;

    let buy_basket_presence = folio_basket.get_token_presence_per_share_in_basket(
        &auction.buy_mint,
        &scaled_folio_token_total_supply,
    )?;

    let current_time = current_time as u64;

    // end auction at limits
    // can still be griefed
    // limits may not be reacheable due to limited precision + defensive roundings
    if sell_basket_presence == auction.sell_limit || buy_basket_presence >= auction.buy_limit {
        auction.end = current_time - 1;
        ctx.accounts.auction_ends.end_time = current_time - 1;
    }
    Ok(())
}
