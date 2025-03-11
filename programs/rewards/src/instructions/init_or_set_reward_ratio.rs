use crate::state::RewardTokens;
use crate::utils::RewardsProgramInternal;
use anchor_lang::prelude::*;
use anchor_spl::token_interface::TokenInterface;
use shared::check_condition;
use shared::constants::REWARD_TOKENS_SEEDS;
use shared::errors::ErrorCode;

/// Initialize or set the reward ratio for the realm.
///
/// # Arguments
/// * `system_program` - The system program.
/// * `token_program` - The token program.
/// * `executor` - The executor account (mut, signer).
/// * `reward_admin` - The reward admin account, PDA of the realm's governance account (signer).
/// * `realm` - The realm account (PDA) (not mut, not signer).
/// * `reward_tokens` - The reward tokens account (PDA) (mut, not signer).
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

    /// CHECK: The reward admin (governance account)
    #[account(signer)]
    pub reward_admin: UncheckedAccount<'info>,

    /// CHECK: Realm
    #[account()]
    pub realm: UncheckedAccount<'info>,

    #[account(mut,
        seeds = [REWARD_TOKENS_SEEDS, realm.key().as_ref()],
        bump,
    )]
    pub reward_tokens: AccountLoader<'info, RewardTokens>,

    /*
    Required accounts for the accrue rewards instruction
     */
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

/// Initialize or set the reward ratio for the realm.
/// Will call the accrue rewards instruction.
///
/// # Arguments
/// * `ctx` - The context of the instruction.
/// * `reward_period` - The reward period (reward's half life).
pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, InitOrSetRewardRatio<'info>>,
    reward_period: u64,
) -> Result<()> {
    ctx.accounts.validate()?;

    // Accrue the rewards before
    RewardsProgramInternal::accrue_rewards(
        &ctx.accounts.system_program,
        &ctx.accounts.token_program,
        &ctx.accounts.realm,
        &ctx.accounts.governance_token_mint,
        &ctx.accounts.governance_staked_token_account,
        &ctx.accounts.executor,
        &ctx.accounts.caller_governance_token_account,
        &ctx.accounts.reward_tokens,
        ctx.remaining_accounts,
        false,
    )?;

    let reward_tokens = &mut ctx.accounts.reward_tokens.load_mut()?;

    reward_tokens.set_reward_ratio(reward_period)?;

    Ok(())
}
