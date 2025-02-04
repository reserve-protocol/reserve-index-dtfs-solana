use anchor_lang::{prelude::*, solana_program::bpf_loader_upgradeable};
use anchor_spl::token_interface::TokenInterface;
use shared::constants::DTF_PROGRAM_SIGNER_SEEDS;

use crate::ID as DTF_PROGRAM_ID;
use crate::{state::DtfProgramSigner, FolioProgram};
use folio::ID as FOLIO_ID;

#[derive(Accounts)]
pub struct DistributeFees<'info> {
    pub rent: Sysvar<'info, Rent>,
    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,

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

    /// CHECK: Done within the folio program
    #[account(mut)]
    pub fee_recipients: UncheckedAccount<'info>,

    /// CHECK: Done within the folio program
    #[account(mut)]
    pub fee_distribution: UncheckedAccount<'info>,

    /// CHECK: Done within the folio program
    #[account(mut)]
    pub dao_fee_recipient: UncheckedAccount<'info>,
    /*
    Remaining accounts will be the token accounts of the fee recipients, needs to follow the
    order of the indices passed as parameters.
     */
}

impl DistributeFees<'_> {
    pub fn validate(&self) -> Result<()> {
        Ok(())
    }
}

pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, DistributeFees<'info>>,
    index: u64,
) -> Result<()> {
    ctx.accounts.validate()?;

    FolioProgram::distribute_fees(ctx, index)?;

    Ok(())
}
