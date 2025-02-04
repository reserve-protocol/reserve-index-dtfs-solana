use crate::{
    events::TradeOpened,
    state::{Actor, Folio, Trade},
};
use anchor_lang::prelude::*;
use shared::{
    constants::{ACTOR_SEEDS, DTF_PROGRAM_SIGNER_SEEDS, PROGRAM_REGISTRAR_SEEDS},
    structs::{FolioStatus, Role},
};

use crate::state::ProgramRegistrar;

#[derive(Accounts)]
pub struct OpenTrade<'info> {
    pub system_program: Program<'info, System>,

    #[account(mut)]
    pub trade_launcher: Signer<'info>,

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
        folio.validate_folio_program_post_init(
            &self.folio.key(),
            Some(&self.program_registrar),
            Some(&self.dtf_program),
            Some(&self.dtf_program_data),
            Some(&self.actor),
            Some(Role::TradeLauncher),
            Some(vec![FolioStatus::Initialized, FolioStatus::Initializing]),
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
