use crate::utils::structs::{FolioStatus, Role};
use crate::{
    events::TradeKilled,
    state::{Actor, Folio, Trade},
};
use anchor_lang::prelude::*;
use shared::constants::ACTOR_SEEDS;

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
}

impl KillTrade<'_> {
    pub fn validate(&self, folio: &Folio, trade: &Trade) -> Result<()> {
        folio.validate_folio(
            &self.folio.key(),
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
