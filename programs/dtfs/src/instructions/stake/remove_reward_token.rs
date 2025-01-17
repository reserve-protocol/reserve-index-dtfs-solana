use crate::state::DtfProgramSigner;
use crate::{FolioProgram, ID as DTF_PROGRAM_ID};
use anchor_lang::prelude::*;
use anchor_lang::solana_program::bpf_loader_upgradeable;
use anchor_spl::associated_token::{get_associated_token_address_with_program_id, AssociatedToken};
use anchor_spl::token;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};
use folio::ID as FOLIO_ID;
use shared::check_condition;
use shared::constants::{
    FOLIO_REWARD_TOKENS_SEEDS, FOLIO_SEEDS, PENDING_BASKET_SEEDS, REWARD_INFO_SEEDS,
};
use shared::errors::ErrorCode;
use shared::structs::{FolioStatus, TokenAmount};
use shared::{
    constants::{ACTOR_SEEDS, DTF_PROGRAM_SIGNER_SEEDS, PROGRAM_REGISTRAR_SEEDS},
    structs::Role,
};
#[derive(Accounts)]
pub struct RemoveRewardToken<'info> {
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
    #[account()]
    pub reward_token_to_remove: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: Done within the folio program
    pub program_registrar: UncheckedAccount<'info>,
}

impl RemoveRewardToken<'_> {
    pub fn validate(&self) -> Result<()> {
        Ok(())
    }
}

pub fn handler<'info>(ctx: Context<'_, '_, 'info, 'info, RemoveRewardToken<'info>>) -> Result<()> {
    ctx.accounts.validate()?;

    FolioProgram::remove_reward_token(ctx)?;

    Ok(())
}
