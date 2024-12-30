use anchor_lang::{prelude::*, solana_program::bpf_loader_upgradeable};
use anchor_spl::token_interface::TokenInterface;
use shared::constants::DTF_PROGRAM_SIGNER_SEEDS;

use crate::ID as DTF_PROGRAM_ID;
use crate::{state::DtfProgramSigner, FolioProgram};
use folio::ID as FOLIO_ID;

#[derive(Accounts)]
pub struct ClosePendingTokenAmounts<'info> {
    pub system_program: Program<'info, System>,

    #[account(mut)]
    pub user: Signer<'info>,

    /// CHECK: Done within the folio program
    pub program_registrar: UncheckedAccount<'info>,

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

    /// CHECK: Folio Program
    #[account(address = FOLIO_ID)]
    pub folio_program: UncheckedAccount<'info>,

    /// CHECK: Done within the folio program
    #[account(mut)]
    pub folio: UncheckedAccount<'info>,

    /// CHECK: Done within the folio program
    #[account(mut)]
    pub user_pending_token_amounts: UncheckedAccount<'info>,
}

impl ClosePendingTokenAmounts<'_> {
    pub fn validate(&self) -> Result<()> {
        Ok(())
    }
}

pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, ClosePendingTokenAmounts<'info>>,
    is_adding_to_mint_folio: u8,
) -> Result<()> {
    FolioProgram::close_pending_token_amounts(ctx, is_adding_to_mint_folio)?;

    Ok(())
}
