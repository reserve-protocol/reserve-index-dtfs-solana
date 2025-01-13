use anchor_lang::prelude::*;
use anchor_lang::solana_program::bpf_loader_upgradeable;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::TokenInterface;
use folio::ID as FOLIO_ID;
use shared::constants::DTF_PROGRAM_SIGNER_SEEDS;

use crate::state::DtfProgramSigner;
use crate::utils::external::folio_program::FolioProgram;
use crate::ID as DTF_PROGRAM_ID;

#[derive(Accounts)]
pub struct AddToBasket<'info> {
    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,

    #[account(mut)]
    pub folio_owner: Signer<'info>,

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
    pub folio_pending_basket: UncheckedAccount<'info>,

    /// CHECK: Done within the folio program
    #[account(mut)]
    pub folio_token_mint: UncheckedAccount<'info>,

    /// CHECK: Done within the folio program
    #[account(mut)]
    pub owner_folio_token_account: UncheckedAccount<'info>,

    /// CHECK: Done within the folio program
    #[account()]
    pub program_registrar: UncheckedAccount<'info>,
    /*
    The remaining accounts need to match the order of amounts as parameter

    Remaining accounts will have as many as possible of the following (always in the same order):
        - Token Mint (read)
        - Sender Token Account (needs to be owned by owner) (mut)
        - Receiver Token Account (needs to be owned by folio) (this is expected to be the ATA and already exist, to save on compute) (mut)
     */
}

impl AddToBasket<'_> {
    pub fn validate(&self) -> Result<()> {
        Ok(())
    }
}

pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, AddToBasket<'info>>,
    amounts: Vec<u64>,
    initial_shares: Option<u64>,
) -> Result<()> {
    ctx.accounts.validate()?;

    FolioProgram::add_to_basket(ctx, amounts, initial_shares)?;

    Ok(())
}
