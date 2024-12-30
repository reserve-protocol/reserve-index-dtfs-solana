use std::cmp::max;

use anchor_lang::{prelude::*, solana_program::bpf_loader_upgradeable};
use anchor_spl::{
    associated_token::{get_associated_token_address_with_program_id, AssociatedToken},
    token,
    token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked},
};
use shared::{
    check_condition,
    constants::{
        FOLIO_PROGRAM_SIGNER_SEEDS, FOLIO_SEEDS, PENDING_TOKEN_AMOUNTS_SEEDS, PRECISION_FACTOR,
        PROGRAM_REGISTRAR_SEEDS,
    },
    structs::TokenAmount,
};
use shared::{constants::DTF_PROGRAM_SIGNER_SEEDS, errors::ErrorCode::*};
use shared::{errors::ErrorCode, structs::FolioStatus};

use crate::ID as DTF_PROGRAM_ID;
use crate::{state::DtfProgramSigner, FolioProgram};
use folio::ID as FOLIO_ID;

#[derive(Accounts)]
pub struct MintFolioToken<'info> {
    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,

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

    #[account(mut)]
    pub folio_token_mint: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: Done within the folio program
    #[account(mut)]
    pub folio_pending_token_amounts: UncheckedAccount<'info>,

    /// CHECK: Done within the folio program
    #[account(mut)]
    pub user_pending_token_amounts: UncheckedAccount<'info>,

    #[account(mut)]
    pub user_folio_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    /*
    The remaining accounts need to match the order of amounts as parameter

    Remaining accounts will have as many as possible of the following (always in the same order):
        - Folio Token Account (in same order as pending token amounts)
     */
}

impl<'info> MintFolioToken<'info> {
    pub fn validate(&self) -> Result<()> {
        Ok(())
    }
}

/*
Shares is how much share the user wants, all the pending token amounts need to be AT LEAST valid for the amount of shares the user wants

Shares follows the precision PRECISION_FACTOR
*/
pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, MintFolioToken<'info>>,
    shares: u64,
) -> Result<()> {
    ctx.accounts.validate()?;

    FolioProgram::mint_folio_token(ctx, shares)?;

    Ok(())
}
