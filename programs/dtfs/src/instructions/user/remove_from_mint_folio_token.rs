use anchor_lang::{prelude::*, solana_program::bpf_loader_upgradeable};
use anchor_spl::{
    associated_token::get_associated_token_address_with_program_id,
    token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked},
};
use folio::ID;
use shared::{
    check_condition,
    constants::{
        FOLIO_PROGRAM_SIGNER_SEEDS, FOLIO_SEEDS, PENDING_TOKEN_AMOUNTS_SEEDS,
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
pub struct RemoveFromMintFolioToken<'info> {
    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,

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
    pub folio_pending_token_amounts: UncheckedAccount<'info>,

    /// CHECK: Done within the folio program
    #[account(mut)]
    pub user_pending_token_amounts: UncheckedAccount<'info>,
    /*
    The remaining accounts need to match the order of amounts as parameter

    Remaining accounts will have as many as possible of the following (always in the same order):
        - Token Mint (read)
        - Sender Token Account (needs to be owned by folio) (mut)
        - Receiver Token Account (needs to be owned by user) (mut)
     */
}

impl<'info> RemoveFromMintFolioToken<'info> {
    pub fn validate(&self) -> Result<()> {
        Ok(())
    }
}

pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, RemoveFromMintFolioToken<'info>>,
    amounts: Vec<u64>,
) -> Result<()> {
    FolioProgram::remove_from_mint_folio_token(ctx, amounts)?;

    Ok(())
}
