use crate::{
    events::TradeKilled,
    state::{Actor, Folio, Trade},
};
use anchor_lang::prelude::*;
use shared::{
    constants::{ACTOR_SEEDS, PROGRAM_REGISTRAR_SEEDS},
    structs::{FolioStatus, Role},
};

use crate::state::ProgramRegistrar;

#[derive(Accounts)]
pub struct KillTrade<'info> {
    pub system_program: Program<'info, System>,

    #[account(mut)]
    pub trade_actor: Signer<'info>,

    #[account(
        seeds = [ACTOR_SEEDS, trade_actor.key().as_ref(), folio.key().as_ref()],
        bump = actor.bump,
    )]
    pub actor: Account<'info, Actor>,

    #[account(mut)]
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

impl KillTrade<'_> {
    pub fn validate(&self, folio: &Folio, trade: &Trade) -> Result<()> {
        folio.validate_folio_program_post_init(
            &self.folio.key(),
            Some(&self.program_registrar),
            Some(&self.dtf_program),
            Some(&self.dtf_program_data),
            Some(&self.actor),
            Some(Role::TradeProposer),
            Some(vec![FolioStatus::Initialized, FolioStatus::Initializing]),
        )?;

        trade.validate_trade(&self.trade.key(), &self.folio.key())?;

        Ok(())
    }
}

pub fn handler(ctx: Context<KillTrade>) -> Result<()> {
    let folio = &mut ctx.accounts.folio.load_mut()?;
    let trade = &mut ctx.accounts.trade.load_mut()?;

    ctx.accounts.validate(folio, trade)?;

    let current_time = Clock::get()?.unix_timestamp as u64;

    trade.end = 1;

    folio.set_trade_end_for_mints(&trade.sell, &trade.buy, current_time);

    emit!(TradeKilled { trade_id: trade.id });

    Ok(())
}
