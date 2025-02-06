use crate::utils::structs::{FolioStatus, Role};
use crate::{
    events::TradeOpened,
    state::{Actor, Folio, Trade},
};
use anchor_lang::prelude::*;
use shared::constants::ACTOR_SEEDS;

#[derive(Accounts)]
pub struct OpenTrade<'info> {
    pub system_program: Program<'info, System>,

    #[account(mut)]
    pub trade_launcher: Signer<'info>,

    #[account(
        seeds = [ACTOR_SEEDS, trade_launcher.key().as_ref(), folio.key().as_ref()],
        bump = actor.bump,
    )]
    pub actor: Account<'info, Actor>,

    #[account()]
    pub folio: AccountLoader<'info, Folio>,

    #[account(mut)]
    pub trade: AccountLoader<'info, Trade>,
}

impl OpenTrade<'_> {
    pub fn validate(
        &self,
        folio: &Folio,
        trade: &Trade,
        sell_limit: u128,
        buy_limit: u128,
        start_price: u128,
        end_price: u128,
    ) -> Result<()> {
        folio.validate_folio(
            &self.folio.key(),
            Some(&self.actor),
            Some(Role::TradeLauncher),
            Some(vec![FolioStatus::Initialized]),
        )?;

        // Validate trade
        trade.validate_trade(&self.trade.key(), &self.folio.key())?;

        // Validate parameters
        trade.validate_trade_opening_from_trade_launcher(
            start_price,
            end_price,
            sell_limit,
            buy_limit,
        )?;

        Ok(())
    }
}

pub fn handler(
    ctx: Context<OpenTrade>,
    sell_limit: u128,
    buy_limit: u128,
    start_price: u128,
    end_price: u128,
) -> Result<()> {
    let folio = &ctx.accounts.folio.load()?;
    let trade = &mut ctx.accounts.trade.load_mut()?;

    ctx.accounts
        .validate(folio, trade, sell_limit, buy_limit, start_price, end_price)?;

    trade.sell_limit.spot = sell_limit;
    trade.buy_limit.spot = buy_limit;
    trade.start_price = start_price;
    trade.end_price = end_price;

    let current_time = Clock::get()?.unix_timestamp as u64;
    trade.open_trade(folio, current_time)?;

    emit!(TradeOpened {
        trade_id: trade.id,
        start_price: trade.start_price,
        end_price: trade.end_price,
        start: trade.start,
        end: trade.end,
    });

    Ok(())
}
