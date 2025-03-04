use crate::state::{Actor, Folio, FolioRewardTokens};
use crate::utils::structs::{FolioStatus, Role};
use crate::utils::FolioProgramInternal;
use anchor_lang::prelude::*;
use anchor_spl::token_interface::TokenInterface;
use shared::check_condition;
use shared::constants::{ACTOR_SEEDS, FOLIO_REWARD_TOKENS_SEEDS, SPL_GOVERNANCE_PROGRAM_ID};
use shared::errors::ErrorCode;

/// Initialize or set the reward ratio for the folio.
///
/// # Arguments
/// * `system_program` - The system program.
/// * `token_program` - The token program.
/// * `executor` - The executor account (mut, signer).
/// * `folio_owner` - The folio owner account (PDA) (not mut, signer) (spl governance account).
/// * `actor` - The actor account of the Folio Owner (PDA) (not mut, not signer).
/// * `folio` - The folio account (PDA) (not mut, not signer).
/// * `folio_reward_tokens` - The folio reward tokens account (PDA) (init if needed, not mut, not signer).
/// * `realm` - The realm account (PDA) (not mut, not signer).
/// * `governance_token_mint` - The governance token mint (community mint) (PDA) (not mut, not signer).
/// * `governance_staked_token_account` - The governance staked token account of all tokens staked in the Realm (PDA) (not mut, not signer).
/// * `caller_governance_token_account` - The caller's token account of governance token (PDA) (not mut, not signer).
#[derive(Accounts)]
pub struct InitOrSetRewardRatio<'info> {
    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,

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

    /*
    Required accounts for the accrue rewards instruction
     */
    /// CHECK: Is the realm related to the folio owner
    #[account()]
    pub realm: UncheckedAccount<'info>,

    /// CHECK: the governance's token mint (community mint)
    #[account()]
    pub governance_token_mint: UncheckedAccount<'info>,

    /// CHECK: the governance's token account of all tokens staked
    #[account()]
    pub governance_staked_token_account: UncheckedAccount<'info>,

    /// CHECK: Caller's token account of governance token
    #[account()]
    pub caller_governance_token_account: UncheckedAccount<'info>,
}

impl InitOrSetRewardRatio<'_> {
    /// Validate the instruction.
    ///
    /// # Checks
    /// * Folio is valid PDA and valid status
    /// * Actor is the folio owner's actor
    /// * Folio owner is a PDA that belongs to the SPL Governance program
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

/// Initialize or set the reward ratio for the folio.
/// Will call the accrue rewards instruction.
///
/// # Arguments
/// * `ctx` - The context of the instruction.
/// * `reward_period` - The reward period (reward's half life).
pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, InitOrSetRewardRatio<'info>>,
    reward_period: u64,
) -> Result<()> {
    let folio_key = ctx.accounts.folio.key();
    let folio = ctx.accounts.folio.load()?;
    ctx.accounts.validate(&folio)?;

    // Accrue the rewards before
    FolioProgramInternal::accrue_rewards(
        &ctx.accounts.system_program,
        &ctx.accounts.token_program,
        &ctx.accounts.realm,
        &ctx.accounts.folio,
        &ctx.accounts.actor,
        &ctx.accounts.folio_owner,
        &ctx.accounts.governance_token_mint,
        &ctx.accounts.governance_staked_token_account,
        &ctx.accounts.executor,
        &ctx.accounts.caller_governance_token_account,
        &ctx.accounts.folio_reward_tokens,
        ctx.remaining_accounts,
        false,
    )?;

    FolioRewardTokens::process_init_if_needed(
        &mut ctx.accounts.folio_reward_tokens,
        ctx.bumps.folio_reward_tokens,
        &folio_key,
        None,
        reward_period,
    )?;

    Ok(())
}
