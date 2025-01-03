use anchor_lang::{prelude::*, solana_program::bpf_loader_upgradeable};
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, TokenAccount, TokenInterface},
};
use shared::constants::DTF_PROGRAM_SIGNER_SEEDS;

use crate::ID as DTF_PROGRAM_ID;
use crate::{state::DtfProgramSigner, FolioProgram};
use folio::ID as FOLIO_ID;

#[derive(Accounts)]
pub struct BurnFolioToken<'info> {
    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,

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

    /*
    Folio Program Accounts
    */
    /// CHECK: Folio Program
    #[account(address = FOLIO_ID)]
    pub folio_program: UncheckedAccount<'info>,

    /// CHECK: Done within the folio program
    #[account(mut)]
    pub folio: UncheckedAccount<'info>,

    #[account(mut)]
    pub folio_token_mint: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: Done within the folio program
    #[account(mut)]
    pub folio_pending_basket: UncheckedAccount<'info>,

    /// CHECK: Done within the folio program
    #[account(mut)]
    pub user_pending_basket: UncheckedAccount<'info>,

    #[account(mut)]
    pub user_folio_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: Done within the folio program
    pub program_registrar: UncheckedAccount<'info>,
    /*
    The remaining accounts need to match the order of amounts as parameter

    Remaining accounts will have as many as possible of the following (always in the same order):
        - Folio Token Account (in same order as pending token amounts)
     */
}

impl BurnFolioToken<'_> {
    pub fn validate(&self) -> Result<()> {
        Ok(())
    }
}

pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, BurnFolioToken<'info>>,
    amount_to_burn: u64,
) -> Result<()> {
    ctx.accounts.validate()?;

    FolioProgram::burn_folio_token(ctx, amount_to_burn)?;

    Ok(())
}
