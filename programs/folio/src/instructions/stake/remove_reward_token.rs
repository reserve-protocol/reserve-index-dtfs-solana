use crate::events::RewardTokenRemoved;
use crate::state::{Actor, Folio, FolioRewardTokens};
use crate::utils::structs::{FolioStatus, Role};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;
use shared::check_condition;
use shared::constants::FOLIO_REWARD_TOKENS_SEEDS;
use shared::constants::{ACTOR_SEEDS, SPL_GOVERNANCE_PROGRAM_ID};
use shared::errors::ErrorCode;

/// Remove a tracked reward token from the folio.
///
/// # Arguments
/// * `system_program` - The system program.
/// * `executor` - The executor account (mut, signer).
/// * `folio_owner` - The folio owner account (PDA) (not mut, signer) (spl governance account).
/// * `actor` - The actor account of the Folio Owner (PDA) (not mut, not signer).
/// * `folio` - The folio account (PDA) (not mut, not signer).
/// * `folio_reward_tokens` - The folio reward tokens account (PDA) (mut, not signer).
/// * `reward_token_to_remove` - The reward token mint to remove (not mut, not signer).
#[derive(Accounts)]
pub struct RemoveRewardToken<'info> {
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

    #[account(mut,
        seeds = [FOLIO_REWARD_TOKENS_SEEDS, folio.key().as_ref()],
        bump
    )]
    pub folio_reward_tokens: AccountLoader<'info, FolioRewardTokens>,

    #[account()]
    pub reward_token_to_remove: Box<InterfaceAccount<'info, Mint>>,
}

impl RemoveRewardToken<'_> {
    /// Validate the instruction.
    ///
    /// # Checks
    /// * Folio is valid PDA and valid status
    /// * Actor is the folio owner's actor
    /// * Reward token to be removed is not the folio token mint
    /// * Folio owner is a PDA that belongs to the SPL Governance program
    pub fn validate(&self, folio: &Folio) -> Result<()> {
        folio.validate_folio(
            &self.folio.key(),
            Some(&self.actor),
            Some(vec![Role::Owner]),
            Some(vec![FolioStatus::Initializing, FolioStatus::Initialized]),
        )?;

        check_condition!(
            self.reward_token_to_remove.key() != folio.folio_token_mint,
            InvalidRewardToken
        );

        // Validate that the caller is the governance account that represents the folio owner
        check_condition!(
            self.folio_owner.owner == &SPL_GOVERNANCE_PROGRAM_ID,
            InvalidGovernanceAccount
        );

        Ok(())
    }
}

/// Remove a tracked reward token from the folio.
///
/// # Arguments
/// * `ctx` - The context of the instruction.
pub fn handler<'info>(ctx: Context<'_, '_, 'info, 'info, RemoveRewardToken<'info>>) -> Result<()> {
    let folio = ctx.accounts.folio.load()?;
    ctx.accounts.validate(&folio)?;

    ctx.accounts
        .folio_reward_tokens
        .load_mut()?
        .remove_reward_token(&ctx.accounts.reward_token_to_remove.key())?;

    emit!(RewardTokenRemoved {
        reward_token: ctx.accounts.reward_token_to_remove.key(),
    });

    Ok(())
}
