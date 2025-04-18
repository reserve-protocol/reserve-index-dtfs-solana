use crate::program::Rewards as RewardsProgram;
use crate::state::{RewardInfo, RewardTokens, UserRewardInfo};
use crate::GovernanceUtil;
use anchor_lang::prelude::*;
use anchor_spl::associated_token::{self};
use anchor_spl::token_interface::{TokenAccount, TokenInterface};
use shared::check_condition;
use shared::constants::REWARD_TOKENS_SEEDS;
use shared::constants::{REWARD_INFO_SEEDS, USER_REWARD_INFO_SEEDS};
use shared::errors::ErrorCode;
use shared::utils::account_util::next_account;

const REMAINING_ACCOUNT_DIVIDER_FOR_CALLER: usize = 4;
const REMAINING_ACCOUNT_DIVIDER_FOR_USER: usize = 5;

/// Accrue rewards for the rewards tokens of the caller (and potentially the user if they are different)
///
/// # Arguments
/// * `system_program` - The system program.
/// * `token_program` - The token program.
/// * `caller` - The caller account (mut, signer).
/// * `realm` - The realm account (PDA) (not mut, not signer).
/// * `reward_tokens` - The reward tokens account (PDA) (not mut, not signer).
/// * `governance_token_mint` - The governance token mint (community mint) (PDA) (not mut, not signer).
/// * `governance_staked_token_account` - The governance staked token account of all tokens staked in the Realm (PDA) (not mut, not signer).
/// * `caller_governance_token_account` - The caller's governance token account representing his staked balance in the Realm (PDA) (not mut, not signer).
/// * `user` - The user account (PDA) (not mut, not signer).
/// * `user_governance_token_account` - The user's governance token account representing his staked balance in the Realm (PDA) (not mut, not signer).
///
/// * `remaining_accounts` - The remaining accounts will represent the rewards tokens to accrue rewards for.
///
/// Order is
///
/// - Reward token mint
/// - Reward info for the token mint (mut)
/// - Token rewards' token account
/// - User reward info for CALLER (mut)
/// - User reward info for USER **IF USER IS NOT CALLER** (mut)

#[derive(Accounts)]
pub struct AccrueRewards<'info> {
    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,

    #[account(mut)]
    pub caller: Signer<'info>,

    /// CHECK: Realm
    #[account()]
    pub realm: UncheckedAccount<'info>,

    #[account(
        seeds = [REWARD_TOKENS_SEEDS, realm.key().as_ref()],
        bump,
    )]
    pub reward_tokens: AccountLoader<'info, RewardTokens>,

    /// CHECK: the governance's token mint (community mint)
    #[account()]
    pub governance_token_mint: UncheckedAccount<'info>,

    /// CHECK: the governance's token account of all tokens staked
    #[account()]
    pub governance_staked_token_account: UncheckedAccount<'info>,

    /// CHECK: Caller's token account of governance token
    #[account()]
    pub caller_governance_token_account: UncheckedAccount<'info>,

    /// CHECK: User's token account (could be the same as the caller's)
    #[account()]
    pub user: UncheckedAccount<'info>,

    /// CHECK: User's governance token account (could be the same as the caller's)
    #[account()]
    pub user_governance_token_account: UncheckedAccount<'info>,
    /*
    Remaining accounts are

    - Reward token mint
    - Reward info for the token mint (mut)
    - Token Rewards' token account
    - User reward info for CALLER (mut)
    - User reward info for USER **IF USER IS NOT CALLER** (mut)
     */
}

/// Accrue rewards for the rewards tokens of the caller (and potentially the user if they are different)
///
/// # Arguments
/// * `system_program` - The system program.
/// * `token_program` - The token program.
/// * `realm` - The realm account
/// * `governance_token_mint` - The governance token mint (community mint)
/// * `governance_staked_token_account` - The governance staked token account of all tokens staked in the Realm
/// * `caller` - The caller account
/// * `caller_governance_token_account` - The caller's governance token account representing his staked balance in the Realm
/// * `user` - The user account
/// * `user_governance_token_account` - The user's governance token account representing his staked balance in the Realm
/// * `reward_tokens` - The reward tokens account
/// * `remaining_accounts` - The remaining accounts will represent the rewards tokens to accrue rewards for.
/// * `token_reward_token_account_is_mutable` - Whether the token rewards' token account is mutable. This is needed because the next_account function
///   needs to know if the account is mutable or not, so it can check if the account is valid, but accrue rewards is called from multiple different instructions, some
///   that do require the token rewards' token account to be mutable, some don't.
#[allow(clippy::too_many_arguments)]
pub fn accrue_rewards<'info>(
    system_program: &AccountInfo<'info>,
    token_program: &AccountInfo<'info>,
    realm: &AccountInfo<'info>,
    governance_token_mint: &AccountInfo<'info>,
    governance_staked_token_account: &AccountInfo<'info>,
    caller: &AccountInfo<'info>,
    caller_governance_token_account: &AccountInfo<'info>,
    user: &AccountInfo<'info>,
    user_governance_token_account: &AccountInfo<'info>,
    reward_tokens: &AccountLoader<'info, RewardTokens>,
    remaining_accounts: &'info [AccountInfo<'info>],
    // Claim rewards has this remaining account as mutable, so we need to pass it in, to pass our check
    token_reward_token_account_is_mutable: bool,
) -> Result<()> {
    let caller_key = caller.key();
    let user_key = user.key();
    let reward_tokens_key = reward_tokens.key();

    let governance_token_mint_key = governance_token_mint.key();
    let token_program_id = token_program.key();
    let realm_key = realm.key();

    let current_time = Clock::get()?.unix_timestamp as u64;

    let reward_tokens = reward_tokens.load()?;

    // Get the total balance of staked governance tokens in the Realm
    let (raw_governance_staked_token_account_balance, governance_token_decimals) =
        GovernanceUtil::get_realm_staked_balance_and_mint_decimals(
            &realm_key,
            governance_token_mint,
            governance_staked_token_account,
        )?;

    let remaining_account_divider = if user.key() == caller.key() {
        REMAINING_ACCOUNT_DIVIDER_FOR_CALLER
    } else {
        REMAINING_ACCOUNT_DIVIDER_FOR_USER
    };

    check_condition!(
        remaining_accounts.len() % remaining_account_divider == 0,
        InvalidNumberOfRemainingAccounts
    );

    let mut remaining_accounts_iter = remaining_accounts.iter();

    for _ in 0..remaining_accounts.len() / remaining_account_divider {
        let reward_token = next_account(
            &mut remaining_accounts_iter,
            false,
            false,
            &token_program_id,
        )?;
        let reward_info = next_account(
            &mut remaining_accounts_iter,
            false,
            true,
            &RewardsProgram::id(),
        )?;
        // Token rewards' token account
        let token_rewards_token_account = next_account(
            &mut remaining_accounts_iter,
            false,
            token_reward_token_account_is_mutable,
            &token_program_id,
        )?;
        let caller_reward_info = next_account(
            &mut remaining_accounts_iter,
            false,
            true,
            &RewardsProgram::id(),
        )?;

        // Check all the pdas
        check_condition!(
            reward_info.key()
                == Pubkey::find_program_address(
                    &[
                        REWARD_INFO_SEEDS,
                        realm_key.as_ref(),
                        reward_token.key().as_ref()
                    ],
                    &RewardsProgram::id()
                )
                .0,
            InvalidRewardInfo
        );

        let expected_pda_for_caller = Pubkey::find_program_address(
            &[
                USER_REWARD_INFO_SEEDS,
                realm_key.as_ref(),
                reward_token.key().as_ref(),
                caller_key.as_ref(),
            ],
            &RewardsProgram::id(),
        );

        check_condition!(
            caller_reward_info.key() == expected_pda_for_caller.0,
            InvalidUserRewardInfo
        );

        // Token rewards' token account
        let token_rewards_token_account_data = token_rewards_token_account.try_borrow_data()?;
        let token_rewards_token_account_parsed =
            TokenAccount::try_deserialize(&mut &token_rewards_token_account_data[..])?;

        check_condition!(
            token_rewards_token_account.key()
                == associated_token::get_associated_token_address_with_program_id(
                    &reward_tokens_key,
                    &reward_token.key(),
                    &token_program_id,
                ),
            InvalidTokenRewardsTokenAccount
        );

        // Accrue rewards on reward info
        let mut reward_info: Account<RewardInfo> = Account::try_from(reward_info)?;
        reward_info.accrue_rewards(
            reward_tokens.reward_ratio,
            token_rewards_token_account_parsed.amount,
            raw_governance_staked_token_account_balance,
            governance_token_decimals,
            current_time,
        )?;

        // Init if needed and accrue rewards on user reward info
        let raw_caller_governance_account_balance = GovernanceUtil::get_governance_account_balance(
            caller_governance_token_account,
            &realm_key,
            &governance_token_mint_key,
            &caller_key,
        )?;

        UserRewardInfo::process_init_if_needed(
            caller_reward_info,
            system_program,
            caller,
            &caller_key,
            expected_pda_for_caller.1,
            &realm_key,
            &reward_token.key(),
            &reward_info,
            raw_caller_governance_account_balance,
        )?;

        // All the logic for the extra user if user != caller
        if remaining_account_divider == REMAINING_ACCOUNT_DIVIDER_FOR_USER {
            let user_reward_info = next_account(
                &mut remaining_accounts_iter,
                false,
                true,
                &RewardsProgram::id(),
            )?;

            let expected_pda_for_user = Pubkey::find_program_address(
                &[
                    USER_REWARD_INFO_SEEDS,
                    realm_key.as_ref(),
                    reward_token.key().as_ref(),
                    user_key.as_ref(),
                ],
                &RewardsProgram::id(),
            );

            check_condition!(
                user_reward_info.key() == expected_pda_for_user.0,
                InvalidUserRewardInfo
            );

            // Create the user reward info if it doesn't exist and accrue rewards on user reward info
            let raw_user_governance_account_balance =
                GovernanceUtil::get_governance_account_balance(
                    user_governance_token_account,
                    &realm_key,
                    &governance_token_mint_key,
                    &user_key,
                )?;

            UserRewardInfo::process_init_if_needed(
                user_reward_info,
                system_program,
                caller,
                &user_key,
                expected_pda_for_user.1,
                &realm_key,
                &reward_token.key(),
                &reward_info,
                raw_user_governance_account_balance,
            )?;
        }

        // Serialize back all the accounts
        let reward_info_account_info = reward_info.to_account_info();
        let reward_info_data = &mut **reward_info_account_info.try_borrow_mut_data()?;
        reward_info.try_serialize(&mut &mut reward_info_data[..])?;
    }

    Ok(())
}

/// Accrue rewards for the rewards tokens of the caller (and potentially the user if they are different).
/// This cannot be called multiple times, it needs to be atomic. Hence why there is a maximum number of
/// reward tokens that can be tracked.
///
/// # Arguments
/// * `ctx` - The context of the instruction.
pub fn handler<'info>(ctx: Context<'_, '_, 'info, 'info, AccrueRewards<'info>>) -> Result<()> {
    accrue_rewards(
        &ctx.accounts.system_program,
        &ctx.accounts.token_program,
        &ctx.accounts.realm,
        &ctx.accounts.governance_token_mint,
        &ctx.accounts.governance_staked_token_account,
        &ctx.accounts.caller,
        &ctx.accounts.caller_governance_token_account,
        &ctx.accounts.user,
        &ctx.accounts.user_governance_token_account,
        &ctx.accounts.reward_tokens,
        ctx.remaining_accounts,
        false,
    )?;

    Ok(())
}
