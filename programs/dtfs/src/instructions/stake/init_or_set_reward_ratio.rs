use crate::state::DtfProgramSigner;
use crate::{FolioProgram, ID as DTF_PROGRAM_ID};
use anchor_lang::prelude::*;
use anchor_lang::solana_program::bpf_loader_upgradeable;
use folio::ID as FOLIO_ID;
use shared::constants::DTF_PROGRAM_SIGNER_SEEDS;

#[derive(Accounts)]
pub struct InitOrSetRewardRatio<'info> {
    pub system_program: Program<'info, System>,

    #[account(mut)]
    pub folio_owner: Signer<'info>,

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
    #[account()]
    pub actor: UncheckedAccount<'info>,

    /// CHECK: Done within the folio program
    #[account()]
    pub folio: UncheckedAccount<'info>,

    /// CHECK: Done within the folio program
    #[account(mut)]
    pub folio_reward_tokens: UncheckedAccount<'info>,

    /// CHECK: Done within the folio program
    pub program_registrar: UncheckedAccount<'info>,
}

impl InitOrSetRewardRatio<'_> {
    pub fn validate(&self) -> Result<()> {
        Ok(())
    }
}

pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, InitOrSetRewardRatio<'info>>,
    reward_period: u64,
) -> Result<()> {
    ctx.accounts.validate()?;

    FolioProgram::init_or_set_reward_ratio(ctx, reward_period)?;
    Ok(())
}
