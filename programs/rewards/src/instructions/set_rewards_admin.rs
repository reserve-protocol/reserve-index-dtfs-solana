use crate::state::RewardTokens;
use crate::utils::GovernanceUtil;
use anchor_lang::prelude::*;
use shared::check_condition;
use shared::constants::{REWARD_TOKENS_SEEDS, SPL_GOVERNANCE_PROGRAM_ID};
use shared::errors::ErrorCode;

/// Set the rewards admin for the realm.
///
/// # Arguments
/// * `system_program` - The system program.
/// * `rent` - The rent sysvar.
/// * `executor` - The executor account (mut, signer).
/// * `reward_admin` - The rewards admin account (PDA) (signer).
/// * `realm` - The realm account (PDA) (not mut, not signer).
/// * `reward_tokens` - The reward tokens account (PDA) (init if needed).
#[derive(Accounts)]
pub struct SetRewardsAdmin<'info> {
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,

    /// The executor
    #[account(mut)]
    pub executor: Signer<'info>,

    /// CHECK: Is the PDA of the governance account that represents the rewards admin (should be signer)
    #[account(signer)]
    pub reward_admin: UncheckedAccount<'info>,

    /// CHECK: Realm
    #[account()]
    pub realm: UncheckedAccount<'info>,

    #[account(init_if_needed,
        payer = executor,
        space = RewardTokens::SIZE,
        seeds = [REWARD_TOKENS_SEEDS, realm.key().as_ref()],
        bump
    )]
    pub reward_tokens: AccountLoader<'info, RewardTokens>,
}

impl SetRewardsAdmin<'_> {
    /// Validate the instruction.
    ///
    /// # Checks
    /// * Realm and reward admin are owned by the SPL Governance program
    /// * Rewards admin is part of the realm
    pub fn validate(&self) -> Result<()> {
        // Validate that the realm is an account owned by the SPL governance program
        check_condition!(
            self.realm.owner == &SPL_GOVERNANCE_PROGRAM_ID,
            InvalidGovernanceAccount
        );

        // Validate that the reward admin is an account owned by the SPL governance program
        check_condition!(
            self.reward_admin.owner == &SPL_GOVERNANCE_PROGRAM_ID,
            InvalidGovernanceAccount
        );

        // Validate that the governance account is part of the realm
        GovernanceUtil::validate_realm_is_valid(&self.realm, &self.reward_admin)?;

        Ok(())
    }
}

/// Set the rewards admin for the realm.
///
/// # Arguments
/// * `ctx` - The context of the instruction.
pub fn handler<'info>(ctx: Context<'_, '_, 'info, 'info, SetRewardsAdmin<'info>>) -> Result<()> {
    ctx.accounts.validate()?;

    RewardTokens::process_init_if_needed(
        &mut ctx.accounts.reward_tokens,
        ctx.bumps.reward_tokens,
        &ctx.accounts.realm.key(),
        &ctx.accounts.reward_admin.key(),
    )?;

    Ok(())
}
