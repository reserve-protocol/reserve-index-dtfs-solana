use anchor_lang::prelude::*;
use anchor_lang::solana_program::bpf_loader_upgradeable;
use folio::ID as FOLIO_ID;
use shared::constants::DTF_PROGRAM_SIGNER_SEEDS;

use crate::state::DtfProgramSigner;
use crate::utils::external::folio_program::FolioProgram;
use crate::ID as DTF_PROGRAM_ID;

#[derive(Accounts)]
pub struct OpenTrade<'info> {
    pub system_program: Program<'info, System>,

    #[account(mut)]
    pub trade_launcher: Signer<'info>,

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
    pub program_registrar: UncheckedAccount<'info>,
}

impl OpenTrade<'_> {
    pub fn validate(&self) -> Result<()> {
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
    ctx.accounts.validate()?;

    FolioProgram::open_trade(ctx, sell_limit, buy_limit, start_price, end_price)?;

    Ok(())
}
