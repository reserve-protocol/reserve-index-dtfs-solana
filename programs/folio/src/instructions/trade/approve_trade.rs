use crate::{
    events::TradeApproved,
    state::{Actor, Folio, Trade},
};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;
use shared::{
    check_condition,
    constants::{ACTOR_SEEDS, MAX_RATE, MAX_TTL, PROGRAM_REGISTRAR_SEEDS, TRADE_SEEDS},
    structs::{FolioStatus, Range, Role},
    util::math_util::U256Number,
};

use crate::state::ProgramRegistrar;
use shared::errors::ErrorCode;

#[derive(Accounts)]
#[instruction(trade_id: u64)]
pub struct ApproveTrade<'info> {
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,

    #[account(mut)]
    pub trade_proposer: Signer<'info>,

    #[account(
        seeds = [ACTOR_SEEDS, trade_proposer.key().as_ref(), folio.key().as_ref()],
        bump = actor.bump,
    )]
    pub actor: Account<'info, Actor>,

    #[account(mut)]
    pub folio: AccountLoader<'info, Folio>,

    #[account(
        init,
        payer = trade_proposer,
        space = Trade::SIZE,
        seeds = [TRADE_SEEDS, folio.key().as_ref(), trade_id.to_le_bytes().as_ref()],
        bump
    )]
    pub trade: AccountLoader<'info, Trade>,

    #[account()]
    pub buy_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account()]
    pub sell_mint: Box<InterfaceAccount<'info, Mint>>,

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
}

impl ApproveTrade<'_> {
    pub fn validate(
        &self,
        folio: &Folio,
        trade_id: u64,
        sell_limit: &Range,
        buy_limit: &Range,
        start_price: u128,
        end_price: u128,
        ttl: u64,
    ) -> Result<()> {
        folio.validate_folio_program_post_init(
            &self.folio.key(),
            Some(&self.program_registrar),
            Some(&self.dtf_program),
            Some(&self.dtf_program_data),
            Some(&self.actor),
            Some(Role::TradeProposer),
            Some(vec![FolioStatus::Initialized, FolioStatus::Initializing]),
        )?;

        check_condition!(folio.current_trade_id + 1 == trade_id, InvalidTradeId);

        check_condition!(self.buy_mint.key() != self.sell_mint.key(), MintCantBeEqual);

        check_condition!(
            sell_limit.spot <= MAX_RATE
                && sell_limit.high <= MAX_RATE
                && sell_limit.low <= sell_limit.spot
                && sell_limit.high >= sell_limit.spot,
            InvalidSellLimit
        );

        check_condition!(
            buy_limit.spot != 0
                && buy_limit.spot <= MAX_RATE
                && buy_limit.high <= MAX_RATE
                && buy_limit.low <= buy_limit.spot
                && buy_limit.high >= buy_limit.spot,
            InvalidBuyLimit
        );

        check_condition!(start_price >= end_price, InvalidPrices);

        check_condition!(ttl >= MAX_TTL, InvalidTtl);

        Ok(())
    }
}

pub fn handler(
    ctx: Context<ApproveTrade>,
    trade_id: u64,
    sell_limit: Range,
    buy_limit: Range,
    start_price: u128,
    end_price: u128,
    ttl: u64,
) -> Result<()> {
    let folio_key = ctx.accounts.folio.key();
    let folio = &mut ctx.accounts.folio.load_mut()?;

    ctx.accounts.validate(
        folio,
        trade_id,
        &sell_limit,
        &buy_limit,
        start_price,
        end_price,
        ttl,
    )?;

    folio.current_trade_id = trade_id;

    let current_time = Clock::get()?.unix_timestamp as u64;

    let trade = &mut ctx.accounts.trade.load_init()?;

    trade.bump = ctx.bumps.trade;
    trade.folio = folio_key;
    trade.id = trade_id;
    trade.sell = ctx.accounts.sell_mint.key();
    trade.buy = ctx.accounts.buy_mint.key();
    trade.sell_limit = sell_limit;
    trade.buy_limit = buy_limit;
    trade.start_price = start_price;
    trade.end_price = end_price;
    trade.available_at = current_time + folio.trade_delay;
    trade.launch_timeout = current_time + ttl;
    trade.start = 0;
    trade.end = 0;
    trade.k = U256Number::ZERO;

    emit!(TradeApproved {
        trade_id,
        from: ctx.accounts.sell_mint.key(),
        to: ctx.accounts.buy_mint.key(),
        amount: 0,
        start_price,
    });

    Ok(())
}
