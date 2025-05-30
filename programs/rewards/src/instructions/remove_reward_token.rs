use crate::events::RewardTokenRemoved;
use crate::state::{RewardInfo, RewardTokens};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount};
use shared::check_condition;
use shared::constants::{REWARD_INFO_SEEDS, REWARD_TOKENS_SEEDS};
use shared::errors::ErrorCode;

/// Remove a tracked reward token from the realm.
///
/// # Arguments
/// * `system_program` - The system program.
/// * `executor` - The executor account (mut, signer).
/// * `reward_admin` - The reward admin account, PDA of the realm's governance account (signer).
/// * `realm` - The realm account (PDA) (not mut, not signer).
/// * `reward_tokens` - The reward tokens account (PDA) (mut, not signer).
/// * `reward_token_to_remove` - The reward token mint to remove (not mut, not signer).
#[derive(Accounts)]
pub struct RemoveRewardToken<'info> {
    pub system_program: Program<'info, System>,

    /// The executor
    #[account(mut)]
    pub executor: Signer<'info>,

    /// CHECK: The reward admin (governance account)
    #[account()]
    pub reward_admin: Signer<'info>,

    /// CHECK: Realm
    #[account()]
    pub realm: UncheckedAccount<'info>,

    #[account(mut,
        seeds = [REWARD_TOKENS_SEEDS, realm.key().as_ref()],
        bump
    )]
    pub reward_tokens: AccountLoader<'info, RewardTokens>,

    /// CHECK: the governance's token mint (community mint)
    #[account()]
    pub governance_token_mint: UncheckedAccount<'info>,

    /// CHECK: the governance's token account of all tokens staked
    #[account()]
    pub governance_staked_token_account: UncheckedAccount<'info>,

    #[account(mut,
        seeds = [REWARD_INFO_SEEDS, realm.key().as_ref(), reward_token_to_remove.key().as_ref()],
        bump
    )]
    pub reward_token_reward_info: Account<'info, RewardInfo>,

    #[account()]
    pub reward_token_to_remove: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        associated_token::mint = reward_token_to_remove,
        associated_token::authority = reward_tokens,
    )]
    pub token_rewards_token_account: InterfaceAccount<'info, TokenAccount>,
}

impl RemoveRewardToken<'_> {
    /// Validate the instruction.
    ///
    /// # Checks
    /// * Reward tokens' saved admin is the reward admin
    /// * Reward tokens' saved realm is the realm
    pub fn validate(&self) -> Result<()> {
        let reward_tokens = self.reward_tokens.load()?;

        check_condition!(
            self.reward_admin.key() == reward_tokens.rewards_admin,
            InvalidGovernanceAccount
        );

        check_condition!(
            reward_tokens.realm == self.realm.key(),
            InvalidGovernanceAccount
        );

        Ok(())
    }
}

/// Remove a tracked reward token from the realm.
///
/// # Arguments
/// * `ctx` - The context of the instruction.
pub fn handler<'info>(ctx: Context<'_, '_, 'info, 'info, RemoveRewardToken<'info>>) -> Result<()> {
    ctx.accounts.validate()?;

    let current_time = Clock::get()?.unix_timestamp;
    ctx.accounts.reward_tokens.load_mut()?.remove_reward_token(
        &ctx.accounts.reward_token_to_remove.key(),
        &ctx.accounts.realm,
        &ctx.accounts.governance_token_mint,
        &ctx.accounts.governance_staked_token_account,
        &mut ctx.accounts.reward_token_reward_info,
        &ctx.accounts.token_rewards_token_account,
        current_time as u64,
    )?;

    emit!(RewardTokenRemoved {
        reward_token: ctx.accounts.reward_token_to_remove.key(),
    });

    Ok(())
}
