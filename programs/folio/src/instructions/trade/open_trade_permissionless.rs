use crate::{
    events::TradeOpened,
    state::{Folio, Trade},
};
use anchor_lang::prelude::*;
use shared::{
    check_condition,
    constants::PROGRAM_REGISTRAR_SEEDS,
    structs::FolioStatus,
};

use crate::state::ProgramRegistrar;
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

impl OpenTradePermissionless<'_> {
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

    trade.open_trade(folio)?;

    emit!(TradeOpened {
        trade_id: trade.id,
        start_price: trade.start_price,
        end_price: trade.end_price,
        start: trade.start,
        end: trade.end,
    });

    Ok(())
}
