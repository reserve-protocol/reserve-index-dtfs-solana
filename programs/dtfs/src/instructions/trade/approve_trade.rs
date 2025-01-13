use anchor_lang::prelude::*;
use anchor_lang::solana_program::bpf_loader_upgradeable;
use folio::ID as FOLIO_ID;
use shared::constants::DTF_PROGRAM_SIGNER_SEEDS;
use shared::structs::Range;

use crate::state::DtfProgramSigner;
use crate::utils::external::folio_program::FolioProgram;
use crate::ID as DTF_PROGRAM_ID;

#[derive(Accounts)]
pub struct ApproveTrade<'info> {
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,

    #[account(mut)]
    pub trade_proposer: Signer<'info>,

    /// CHECK: Done within the folio program
    #[account(mut)]
    pub actor: UncheckedAccount<'info>,

    /*
    DTF Program Accounts
    */
    #[account(
        seeds = [DTF_PROGRAM_SIGNER_SEEDS],
        bump = dtf_program_signer.bump
    )]
    pub dtf_program_signer: Account<'info, DtfProgramSigner>,

    /// CHECK: DTF Program
    #[account(address = DTF_PROGRAM_ID)]
    pub dtf_program: UncheckedAccount<'info>,

    /// CHECK: DTF Program Data
    #[account(
        seeds = [DTF_PROGRAM_ID.as_ref()],
        bump,
        seeds::program = &bpf_loader_upgradeable::id()
    )]
    pub dtf_program_data: UncheckedAccount<'info>,

    /*
    Folio Program Accounts
    */
    /// CHECK: Folio Program
    #[account(address = FOLIO_ID)]
    pub folio_program: UncheckedAccount<'info>,

    /// CHECK: Done within the folio program
    #[account(mut)]
    pub folio: UncheckedAccount<'info>,

    /// CHECK: Done within the folio program
    #[account(mut)]
    pub trade: UncheckedAccount<'info>,

    /// CHECK: Done within the folio program
    #[account()]
    pub buy_mint: UncheckedAccount<'info>,

    /// CHECK: Done within the folio program
    #[account()]
    pub sell_mint: UncheckedAccount<'info>,

    /// CHECK: Done within the folio program
    pub program_registrar: UncheckedAccount<'info>,
}

impl ApproveTrade<'_> {
    pub fn validate(&self) -> Result<()> {
        Ok(())
    }
}

pub fn handler(
    ctx: Context<ApproveTrade>,
    trade_id: u64,
    sell_limit: Range,
    buy_limit: Range,
    start_price: u64,
    end_price: u64,
    ttl: u64,
) -> Result<()> {
    ctx.accounts.validate()?;

    FolioProgram::approve_trade(
        ctx,
        trade_id,
        sell_limit,
        buy_limit,
        start_price,
        end_price,
        ttl,
    )?;

    Ok(())
}
