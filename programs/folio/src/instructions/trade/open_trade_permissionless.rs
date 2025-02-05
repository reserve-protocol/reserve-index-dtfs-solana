use crate::utils::structs::FolioStatus;
use crate::{
    events::TradeOpened,
    state::{Folio, Trade},
};
use anchor_lang::prelude::*;
use shared::check_condition;

use shared::errors::ErrorCode;

#[derive(Accounts)]
pub struct OpenTradePermissionless<'info> {
    pub system_program: Program<'info, System>,

    #[account(mut)]
    pub user: Signer<'info>,

    #[account()]
    pub folio: AccountLoader<'info, Folio>,

    #[account(mut)]
    pub trade: AccountLoader<'info, Trade>,
}

impl OpenTradePermissionless<'_> {
    pub fn validate(&self, folio: &Folio, trade: &Trade) -> Result<()> {
        folio.validate_folio(
            &self.folio.key(),
            None,
            None,
            Some(vec![FolioStatus::Initialized, FolioStatus::Initializing]),
        )?;

        // Validate trade
        trade.validate_trade(&self.trade.key(), &self.folio.key())?;

        // Only open trade that have not timed out
        check_condition!(
            Clock::get()?.unix_timestamp as u64 >= trade.available_at,
            TradeCannotBeOpenedPermissionlesslyYet
        );

        Ok(())
    }
}

pub fn handler(ctx: Context<OpenTradePermissionless>) -> Result<()> {
    let folio = &ctx.accounts.folio.load()?;
    let trade = &mut ctx.accounts.trade.load_mut()?;

    ctx.accounts.validate(folio, trade)?;

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
