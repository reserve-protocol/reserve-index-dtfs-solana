use anchor_lang::prelude::*;
use anchor_lang::solana_program::bpf_loader_upgradeable;
use folio::ID as FOLIO_ID;
use shared::constants::DTF_PROGRAM_SIGNER_SEEDS;

use crate::state::DtfProgramSigner;
use crate::utils::external::folio_program::FolioProgram;
use crate::ID as DTF_PROGRAM_ID;

#[derive(Accounts)]
pub struct KillTrade<'info> {
    pub system_program: Program<'info, System>,

    #[account(mut)]
    pub trade_actor: Signer<'info>,

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

impl KillTrade<'_> {
    pub fn validate(&self) -> Result<()> {
        Ok(())
    }
}

pub fn handler(ctx: Context<KillTrade>) -> Result<()> {
    ctx.accounts.validate()?;

    FolioProgram::kill_trade(ctx)?;

    Ok(())
}
