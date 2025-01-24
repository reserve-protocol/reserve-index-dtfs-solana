use crate::{
    cpi_call,
    state::{Folio, FolioBasket, Trade},
};
use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked},
};
use shared::{
    check_condition,
    constants::{D27, FOLIO_BASKET_SEEDS, FOLIO_SEEDS, PROGRAM_REGISTRAR_SEEDS},
    structs::FolioStatus,
    util::math_util::CustomPreciseNumber,
};

use crate::state::ProgramRegistrar;
use shared::errors::ErrorCode;

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

    #[account(mut)]
    pub folio_token_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut)]
    pub trade: AccountLoader<'info, Trade>,

    #[account(mut)]
    pub trade_sell_token_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut)]
    pub trade_buy_token_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut,
    associated_token::mint = trade_sell_token_mint,
    associated_token::authority = folio,
    )]
    pub folio_sell_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut,
    associated_token::mint = trade_buy_token_mint,
    associated_token::authority = folio,
    )]
    pub folio_buy_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut,
    associated_token::mint = trade_sell_token_mint,
    associated_token::authority = bidder,
    )]
    pub bidder_sell_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut,
    associated_token::mint = trade_buy_token_mint,
    associated_token::authority = bidder,
    )]
    pub bidder_buy_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /*
    Account to validate
    */
    #[account(
        seeds = [PROGRAM_REGISTRAR_SEEDS],
        bump = program_registrar.bump
    )]
    pub program_registrar: Box<Account<'info, ProgramRegistrar>>,

    /// CHECK: DTF program used for creating owner record
    #[account()]
    pub dtf_program: UncheckedAccount<'info>,

    /// CHECK: DTF program data to validate program deployment slot
    #[account()]
    pub dtf_program_data: UncheckedAccount<'info>,
    /*
    For the callback it'll happen with the remaining accounts
     */
}

impl Bid<'_> {
    pub fn validate(&self, folio: &Folio, trade: &Trade) -> Result<()> {
        folio.validate_folio_program_post_init(
            &self.folio.key(),
            Some(&self.program_registrar),
            Some(&self.dtf_program),
            Some(&self.dtf_program_data),
            None,
            None,
            Some(vec![FolioStatus::Initialized, FolioStatus::Initializing]),
        )?;

        check_condition!(
            self.folio_token_mint.key() == folio.folio_token_mint,
            InvalidFolioTokenMint
        );

        check_condition!(
            self.trade_sell_token_mint.key() == trade.sell,
            InvalidTradeSellTokenMint
        );

        check_condition!(
            self.trade_buy_token_mint.key() == trade.buy,
            InvalidTradeBuyTokenMint
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
    let trade = &mut ctx.accounts.trade.load_mut()?;

    ctx.accounts.validate(folio, trade)?;

    let current_time = Clock::get()?.unix_timestamp as u64;

    let price = trade.get_price(current_time)?;

    let bought_amount = CustomPreciseNumber::from_u64(sell_amount)
        .mul_generic(price)
        .to_u64_ceil();

    check_condition!(bought_amount <= max_buy_amount, SlippageExceeded);

    let folio_token_total_supply = folio.get_total_supply(folio_token_mint.supply)?;

    // Sell related logic
    let sell_balance = ctx.accounts.folio_sell_token_account.amount;

    let min_sell_balance = match CustomPreciseNumber::from_u128(trade.sell_limit.spot)
        .mul_div_generic(folio_token_total_supply as u128, D27)
        .to_u64_ceil()
    {
        min_sell_balance if sell_balance > min_sell_balance => sell_balance - min_sell_balance,
        _ => 0,
    };

    check_condition!(sell_amount <= min_sell_balance, InsufficientBalance);

    let folio_basket = &mut ctx.accounts.folio_basket.load_mut()?;
    folio_basket.add_tokens_to_basket(&vec![trade.buy])?;

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
                mint: ctx.accounts.trade_sell_token_mint.to_account_info(),
            },
            &[signer_seeds],
        ),
        sell_amount,
        ctx.accounts.trade_sell_token_mint.decimals,
    )?;

    emit!(crate::events::Bid {
        trade_id: trade.id,
        sell_amount,
        bought_amount,
    });

    // Check if we sold out all the tokens of the sell mint
    ctx.accounts.folio_sell_token_account.reload()?;
    if ctx.accounts.folio_sell_token_account.amount == 0 {
        trade.end = current_time;

        {
            let folio = &mut ctx.accounts.folio.load_mut()?;
            folio.set_trade_end_for_mints(&trade.sell, &trade.buy, current_time);
        }

        folio_basket.remove_tokens_from_basket(&vec![trade.sell])?;
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
                    mint: ctx.accounts.trade_buy_token_mint.to_account_info(),
                },
            ),
            bought_amount,
            ctx.accounts.trade_buy_token_mint.decimals,
        )?;
    }

    // Validate max buy balance
    let max_buy_balance = CustomPreciseNumber::from_u128(trade.buy_limit.spot)
        .mul_generic(folio_token_total_supply as u128)
        .to_u64_floor();

    ctx.accounts.folio_buy_token_account.reload()?;
    check_condition!(
        ctx.accounts.folio_buy_token_account.amount <= max_buy_balance,
        ExcessiveBid
    );

    Ok(())
}
