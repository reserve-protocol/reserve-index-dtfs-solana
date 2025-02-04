use crate::{
    events::TradeOpened,
    state::{Folio, Trade},
};
use anchor_lang::prelude::*;
use shared::{
    check_condition,
    constants::{DTF_PROGRAM_SIGNER_SEEDS, PROGRAM_REGISTRAR_SEEDS},
    structs::FolioStatus,
};

use crate::state::ProgramRegistrar;
use shared::errors::ErrorCode;

#[derive(Accounts)]
pub struct OpenTradePermissionless<'info> {
    pub system_program: Program<'info, System>,

    #[account(mut)]
    pub user: Signer<'info>,

    /*
    Account to validate
    */
    #[account(
        seeds = [DTF_PROGRAM_SIGNER_SEEDS],
        bump,
        seeds::program = dtf_program.key(),
    )]
    pub dtf_program_signer: Signer<'info>,

    /// CHECK: DTF program used for creating owner record
    #[account()]
    pub dtf_program: UncheckedAccount<'info>,

    /// CHECK: DTF program data to validate program deployment slot
    #[account()]
    pub dtf_program_data: UncheckedAccount<'info>,

    #[account(
        seeds = [PROGRAM_REGISTRAR_SEEDS],
        bump = program_registrar.bump
    )]
    pub program_registrar: Box<Account<'info, ProgramRegistrar>>,

    #[account()]
    pub folio: AccountLoader<'info, Folio>,

    #[account(mut)]
    pub trade: AccountLoader<'info, Trade>,
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
