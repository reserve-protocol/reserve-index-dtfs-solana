use crate::state::{RewardInfo, RewardTokens, UserRewardInfo};
use crate::utils::RewardsProgramInternal;
use anchor_lang::prelude::*;
use anchor_spl::associated_token::{self};
use anchor_spl::token_interface;
use anchor_spl::token_interface::{Mint, TokenInterface, TransferChecked};
use shared::check_condition;
use shared::constants::D9_U128;
use shared::constants::{REWARD_INFO_SEEDS, REWARD_TOKENS_SEEDS, USER_REWARD_INFO_SEEDS};
use shared::errors::ErrorCode;
use shared::utils::account_util::next_account;
use shared::utils::{Decimal, Rounding};

const REMAINING_ACCOUNTS_DIVIDER: usize = 5;
const REMAINING_ACCOUNTS_UPPER_INDEX_FOR_ACCRUE_REWARDS: usize = 4;

/// Claim rewards for a user.
///
/// # Arguments
/// * `system_program` - The system program.
/// * `token_program` - The token program.
/// * `user` - The user account (mut, signer).
/// * `realm` - The realm account (PDA) (not mut, not signer).
/// * `reward_tokens` - The reward tokens account (PDA) (not mut, not signer).
/// * `governance_token_mint` - The governance token mint (community mint) (PDA) (not mut, not signer).
/// * `governance_staked_token_account` - The governance staked token account of all tokens staked in the Realm (PDA) (not mut, not signer).
/// * `caller_governance_token_account` - The caller's token account of governance token (PDA) (not mut, not signer).
///
/// Remaining accounts are to represent the reward tokens to claim rewards for.
///
/// Order is
///
/// - Reward token mint
/// - Reward info for the token mint (mut)
/// - Token rewards' token account (mut) (to send)
/// - User reward info (mut)
/// - User reward token account (mut) (to receive)
#[derive(Accounts)]
pub struct ClaimRewards<'info> {
    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,

    #[account(mut)]
    pub user: Signer<'info>,

    /// CHECK: Realm
    #[account()]
    pub realm: UncheckedAccount<'info>,

    #[account(
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
    /*
    Remaining accounts are

    - Reward token mint
    - Reward info for the token mint (mut)
    - Token rewards' token account (mut) (to send)
    - User reward info (mut)
    - User reward token account (mut) (to receive)
     */
}

/// Claim rewards for a user.
/// Also calls the accrue rewards instruction BEFORE doing the claim, so that the user claims the maximum of rewards available at the
/// current time.
///
/// # Arguments
/// * `ctx` - The context of the instruction.
pub fn handler<'info>(ctx: Context<'_, '_, 'info, 'info, ClaimRewards<'info>>) -> Result<()> {
    let reward_tokens_key = ctx.accounts.reward_tokens.key();
    let realm_key = ctx.accounts.realm.key();
    let user_key = ctx.accounts.user.key();
    let token_program_id = ctx.accounts.token_program.key();

    check_condition!(
        ctx.remaining_accounts.len() % REMAINING_ACCOUNTS_DIVIDER == 0,
        InvalidNumberOfRemainingAccounts
    );

    // Proceed with the claim rewards
    let reward_tokens = ctx.accounts.reward_tokens.load()?;

    let reward_tokens_seeds = &[
        REWARD_TOKENS_SEEDS,
        realm_key.as_ref(),
        &[reward_tokens.bump],
    ];

    let signer_seeds = &[&reward_tokens_seeds[..]];

    let mut remaining_accounts_iter = ctx.remaining_accounts.iter();

    for i in 0..ctx.remaining_accounts.len() / REMAINING_ACCOUNTS_DIVIDER {
        // Accrue the rewards before
        RewardsProgramInternal::accrue_rewards(
            &ctx.accounts.system_program,
            &ctx.accounts.token_program,
            &ctx.accounts.realm,
            &ctx.accounts.governance_token_mint,
            &ctx.accounts.governance_staked_token_account,
            &ctx.accounts.user,
            &ctx.accounts.caller_governance_token_account,
            &ctx.accounts.reward_tokens,
            // Only the first `REMAINING_ACCOUNTS_UPPER_INDEX_FOR_ACCRUE_REWARDS` accounts are needed for the accrue rewards instruction, the last one is for claim only
            &ctx.remaining_accounts[i * REMAINING_ACCOUNTS_DIVIDER
                ..(i * REMAINING_ACCOUNTS_DIVIDER)
                    + REMAINING_ACCOUNTS_UPPER_INDEX_FOR_ACCRUE_REWARDS],
            true,
        )?;

        let reward_token = next_account(
            &mut remaining_accounts_iter,
            false,
            false,
            &token_program_id,
        )?;
        let reward_info = next_account(&mut remaining_accounts_iter, false, true, &crate::id())?;
        let token_rewards_token_account =
            next_account(&mut remaining_accounts_iter, false, true, &token_program_id)?;
        let user_reward_info =
            next_account(&mut remaining_accounts_iter, false, true, &crate::id())?;
        let user_reward_token_account =
            next_account(&mut remaining_accounts_iter, false, true, &token_program_id)?;

        // Check all the pdas
        check_condition!(
            reward_info.key()
                == Pubkey::find_program_address(
                    &[
                        REWARD_INFO_SEEDS,
                        realm_key.as_ref(),
                        reward_token.key().as_ref()
                    ],
                    &crate::id()
                )
                .0,
            InvalidRewardInfo
        );

        let expected_pda_for_user = Pubkey::find_program_address(
            &[
                USER_REWARD_INFO_SEEDS,
                realm_key.as_ref(),
                reward_token.key().as_ref(),
                user_key.as_ref(),
            ],
            &crate::id(),
        );

        check_condition!(
            user_reward_info.key() == expected_pda_for_user.0,
            InvalidUserRewardInfo
        );

        let data = reward_token.try_borrow_data()?;
        let mint = Mint::try_deserialize(&mut &data[..])?;

        check_condition!(
            token_rewards_token_account.key()
                == associated_token::get_associated_token_address_with_program_id(
                    &reward_tokens_key,
                    &reward_token.key(),
                    &token_program_id,
                ),
            InvalidTokenRewardsTokenAccount
        );

        // Update the accounts
        let reward_info = &reward_info;
        let user_reward_info = &user_reward_info;

        let mut reward_info = Account::<RewardInfo>::try_from(reward_info)?;
        let mut user_reward_info = Account::<UserRewardInfo>::try_from(user_reward_info)?;

        let raw_claimable_rewards = Decimal::from_scaled(user_reward_info.accrued_rewards)
            .to_token_amount(Rounding::Floor)?;

        let scaled_claimable_rewards_without_dust = (raw_claimable_rewards.0 as u128)
            .checked_mul(D9_U128)
            .ok_or(ErrorCode::MathOverflow)?;

        // Add the amount without dust as claimed
        reward_info.total_claimed = reward_info
            .total_claimed
            .checked_add(scaled_claimable_rewards_without_dust)
            .ok_or(ErrorCode::MathOverflow)?;

        user_reward_info.accrued_rewards = user_reward_info
            .accrued_rewards
            .checked_sub(scaled_claimable_rewards_without_dust)
            .ok_or(ErrorCode::MathOverflow)?;

        reward_info.exit(ctx.program_id)?;
        user_reward_info.exit(ctx.program_id)?;

        // Because of potential rounding errors since we have to go back to u64, if user claims too early it might
        // be 0 as a u64, we don't want to update the other fields while not giving anything, so we'll error out.
        check_condition!(raw_claimable_rewards.0 > 0, NoRewardsToClaim);

        // Send the reward to the user
        let cpi_accounts = TransferChecked {
            from: token_rewards_token_account.to_account_info(),
            to: user_reward_token_account.to_account_info(),
            authority: ctx.accounts.reward_tokens.to_account_info(),
            mint: reward_token.to_account_info(),
        };

        let cpi_program = ctx.accounts.token_program.to_account_info();

        token_interface::transfer_checked(
            CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds),
            raw_claimable_rewards.0,
            mint.decimals,
        )?;
    }

    Ok(())
}
