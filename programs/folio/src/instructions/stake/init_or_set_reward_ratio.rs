use crate::state::{Actor, Folio, FolioRewardTokens};
use crate::utils::structs::{FolioStatus, Role};
use anchor_lang::prelude::*;
use shared::check_condition;
use shared::constants::{ACTOR_SEEDS, FOLIO_REWARD_TOKENS_SEEDS, SPL_GOVERNANCE_PROGRAM_ID};
use shared::errors::ErrorCode;

#[derive(Accounts)]
pub struct InitOrSetRewardRatio<'info> {
    pub system_program: Program<'info, System>,

    /// The executor
    #[account(mut)]
    pub executor: Signer<'info>,

    /// CHECK: Is the PDA of the governance account that represents the folio owner (should be signer)
    #[account(signer)]
    pub folio_owner: UncheckedAccount<'info>,

    #[account(
        seeds = [ACTOR_SEEDS, folio_owner.key().as_ref(), folio.key().as_ref()],
        bump = actor.bump,
    )]
    pub actor: Account<'info, Actor>,

    #[account()]
    pub folio: AccountLoader<'info, Folio>,

    #[account(init_if_needed,
        payer = executor,
        space = FolioRewardTokens::SIZE,
        seeds = [FOLIO_REWARD_TOKENS_SEEDS, folio.key().as_ref()],
        bump
    )]
    pub folio_reward_tokens: AccountLoader<'info, FolioRewardTokens>,
}

impl InitOrSetRewardRatio<'_> {
    pub fn validate(&self, folio: &Folio) -> Result<()> {
        folio.validate_folio(
            &self.folio.key(),
            Some(&self.actor),
            Some(vec![Role::Owner]),
            Some(vec![FolioStatus::Initializing, FolioStatus::Initialized]),
        )?;

        // Validate that the caller is the governance account that represents the folio owner
        check_condition!(
            self.folio_owner.owner == &SPL_GOVERNANCE_PROGRAM_ID,
            InvalidGovernanceAccount
        );

        Ok(())
    }
}

pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, InitOrSetRewardRatio<'info>>,
    reward_period: u64,
) -> Result<()> {
    let folio_key = ctx.accounts.folio.key();
    let folio = ctx.accounts.folio.load()?;
    ctx.accounts.validate(&folio)?;

    FolioRewardTokens::process_init_if_needed(
        &mut ctx.accounts.folio_reward_tokens,
        ctx.bumps.folio_reward_tokens,
        &folio_key,
        None,
        reward_period,
    )?;

    Ok(())
}
