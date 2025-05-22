use crate::events::RewardTokenAdded;
use crate::state::{RewardInfo, RewardTokens};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount};
use shared::check_condition;
use shared::constants::{REWARD_INFO_SEEDS, REWARD_TOKENS_SEEDS};
use shared::errors::ErrorCode;
use shared::utils::TokenUtil;

/// Add a tracked reward token to the realm.
///
/// # Arguments
/// * `system_program` - The system program.
/// * `executor` - The executor account (mut, signer).
/// * `reward_admin` - The reward admin account, PDA of the realm's governance account (signer).
/// * `realm` - The realm account (PDA) (not mut, not signer).
/// * `reward_tokens` - The reward tokens account (PDA) (mut, not signer).
/// * `reward_token` - The reward token mint (not mut, not signer).
/// * `reward_token_reward_info` - The reward token reward info account (init if needed, not signer).
/// * `reward_token_account` - The reward token account (not mut, not signer).
#[derive(Accounts)]
#[instruction(index: u64)]
pub struct AddRewardToken<'info> {
    pub system_program: Program<'info, System>,

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

    #[account()]
    pub reward_token: Box<InterfaceAccount<'info, Mint>>,

    #[account(init,
        payer = executor,
        space = RewardInfo::SIZE,
        seeds = [REWARD_INFO_SEEDS, realm.key().as_ref(), index.to_le_bytes().as_ref(), reward_token.key().as_ref()],
        bump
    )]
    pub reward_token_reward_info: Account<'info, RewardInfo>,

    #[account()]
    pub reward_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
}

impl AddRewardToken<'_> {
    /// Validate the instruction.
    ///
    /// # Checks
    /// * Reward token account is the correct mint
    /// * Reward token account is owned by the reward tokens account
    /// * Reward token is a supported SPL token
    /// * Reward tokens' saved admin is the reward admin
    /// * Reward tokens' saved realm is the realm
    pub fn validate(&self) -> Result<()> {
        check_condition!(
            self.reward_token_account.mint == self.reward_token.key(),
            InvalidRewardMint
        );

        // Token owner needs to be the reward tokens account, so we can sign
        check_condition!(
            self.reward_token_account.owner == self.reward_tokens.key(),
            InvalidRewardTokenAccount
        );

        // Check that the reward token is a supported SPL token (doesn't require extra accounts for transfers)
        check_condition!(
            TokenUtil::is_supported_spl_token(
                Some(&self.reward_token.to_account_info()),
                Some(&self.reward_token_account.to_account_info())
            )?,
            UnsupportedSPLToken
        );

        // Validate reward tokens account
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

/// Add a tracked reward token to the realm.
///
/// # Arguments
/// * `ctx` - The context of the instruction.
/// * `index` - The index of the reward token. Random number passed by the user.
pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, AddRewardToken<'info>>,
    index: u64,
) -> Result<()> {
    let realm_key = ctx.accounts.realm.key();
    ctx.accounts.validate()?;

    RewardInfo::process_init_if_needed(
        &mut ctx.accounts.reward_token_reward_info,
        ctx.bumps.reward_token_reward_info,
        &realm_key,
        &ctx.accounts.reward_token.key(),
        ctx.accounts.reward_token_account.amount,
        index,
    )?;

    let reward_tokens = &mut ctx.accounts.reward_tokens.load_mut()?;

    reward_tokens.add_reward_token(
        &ctx.accounts.reward_token_reward_info.key(),
        &ctx.accounts.reward_token_reward_info,
    )?;

    emit!(RewardTokenAdded {
        reward_token: ctx.accounts.reward_token.key(),
    });

    Ok(())
}
