use anchor_lang::{prelude::*, solana_program::bpf_loader_upgradeable};
use shared::constants::DTF_PROGRAM_SIGNER_SEEDS;

use crate::ID as DTF_PROGRAM_ID;
use crate::{state::DtfProgramSigner, FolioProgram};
use folio::ID as FOLIO_ID;

#[derive(Accounts)]
pub struct PokeFolio<'info> {
    pub system_program: Program<'info, System>,

    #[account(mut)]
    pub user: Signer<'info>,

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

    /// CHECK: Done within the folio program
    pub program_registrar: UncheckedAccount<'info>,

    /// CHECK: DAO fee config to get fee for minting
    #[account()]
    pub dao_fee_config: UncheckedAccount<'info>,

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
    pub folio_token_mint: UncheckedAccount<'info>,
}

impl PokeFolio<'_> {
    pub fn validate(&self) -> Result<()> {
        Ok(())
    }
}

pub fn handler<'info>(ctx: Context<'_, '_, 'info, 'info, PokeFolio<'info>>) -> Result<()> {
    ctx.accounts.validate()?;

    FolioProgram::poke_folio(ctx)?;

    Ok(())
}
