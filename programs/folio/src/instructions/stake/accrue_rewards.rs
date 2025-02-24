use crate::program::Folio as FolioProgram;
use crate::state::{Actor, Folio, FolioRewardTokens, RewardInfo, UserRewardInfo};
use crate::utils::account_util::next_account;
use crate::utils::structs::{FolioStatus, Role};
use crate::GovernanceUtil;
use anchor_lang::prelude::*;
use anchor_spl::associated_token::{self};
use anchor_spl::token_interface::{TokenAccount, TokenInterface};
use shared::check_condition;
use shared::constants::ACTOR_SEEDS;
use shared::constants::{FOLIO_REWARD_TOKENS_SEEDS, REWARD_INFO_SEEDS, USER_REWARD_INFO_SEEDS};
use shared::errors::ErrorCode;

const REMAINING_ACCOUNT_DIVIDER_FOR_CALLER: usize = 4;
const REMAINING_ACCOUNT_DIVIDER_FOR_USER: usize = 5;

#[derive(Accounts)]
pub struct AccrueRewards<'info> {
    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,

    #[account(mut)]
    pub caller: Signer<'info>,

    /// CHECK: Is the realm related to the folio owner
    #[account()]
    pub realm: UncheckedAccount<'info>,

    /// CHECK: Folio owner
    #[account()]
    pub folio_owner: UncheckedAccount<'info>,

    #[account(
        seeds = [ACTOR_SEEDS, folio_owner.key().as_ref(), folio.key().as_ref()],
        bump = actor.bump,
    )]
    pub actor: Account<'info, Actor>,

    #[account()]
    pub folio: AccountLoader<'info, Folio>,

    #[account(
        seeds = [FOLIO_REWARD_TOKENS_SEEDS, folio.key().as_ref()],
        bump,
    )]
    pub folio_reward_tokens: AccountLoader<'info, FolioRewardTokens>,

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
    - Fee recipient token account (needs to be the FOLIO TOKEN REWARDS' token account, not the DAO's)
    - User reward info for CALLER (mut)
    - User reward info for USER **IF USER IS NOT CALLER** (mut)
     */
}

impl AccrueRewards<'_> {
    pub fn validate(&self, folio: &Folio) -> Result<()> {
        folio.validate_folio(
            &self.folio.key(),
            Some(&self.actor),
            Some(vec![Role::Owner]),
            Some(vec![FolioStatus::Initializing, FolioStatus::Initialized]),
        )?;

        // Validate that the caller is the realm governance account that represents the folio owner
        GovernanceUtil::validate_realm_is_valid(&self.realm, &self.folio_owner)?;

        Ok(())
    }
}

// This cant be called multiple times, needs to be atomic
pub fn handler<'info>(ctx: Context<'_, '_, 'info, 'info, AccrueRewards<'info>>) -> Result<()> {
    let folio_key = ctx.accounts.folio.key();
    let folio_reward_tokens_key = ctx.accounts.folio_reward_tokens.key();
    let governance_token_mint_key = ctx.accounts.governance_token_mint.key();

    let caller_key = ctx.accounts.caller.key();
    let user_key = ctx.accounts.user.key();

    let token_program_id = ctx.accounts.token_program.key();

    let current_time = Clock::get()?.unix_timestamp as u64;

    let realm_key = ctx.accounts.realm.key();

    let folio = ctx.accounts.folio.load()?;
    ctx.accounts.validate(&folio)?;

    let folio_reward_tokens = ctx.accounts.folio_reward_tokens.load()?;

    let (raw_governance_staked_token_account_balance, governance_token_decimals) =
        GovernanceUtil::get_realm_staked_balance_and_mint_decimals(
            &realm_key,
            &ctx.accounts.governance_token_mint,
            &ctx.accounts.governance_staked_token_account,
        )?;

    let remaining_account_divider = if ctx.accounts.user.key() == ctx.accounts.caller.key() {
        REMAINING_ACCOUNT_DIVIDER_FOR_CALLER
    } else {
        REMAINING_ACCOUNT_DIVIDER_FOR_USER
    };

    check_condition!(
        ctx.remaining_accounts.len() % remaining_account_divider == 0,
        InvalidNumberOfRemainingAccounts
    );

    let mut remaining_accounts_iter = ctx.remaining_accounts.iter();

    for _ in 0..ctx.remaining_accounts.len() / remaining_account_divider {
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
            &FolioProgram::id(),
        )?;
        // Folio token rewards' token account
        let fee_recipient_token_account = next_account(
            &mut remaining_accounts_iter,
            false,
            false,
            &token_program_id,
        )?;
        let caller_reward_info = next_account(
            &mut remaining_accounts_iter,
            false,
            true,
            &FolioProgram::id(),
        )?;

        // Check all the pdas
        check_condition!(
            reward_info.key()
                == Pubkey::find_program_address(
                    &[
                        REWARD_INFO_SEEDS,
                        folio_key.as_ref(),
                        reward_token.key().as_ref()
                    ],
                    &FolioProgram::id()
                )
                .0,
            InvalidRewardInfo
        );

        let expected_pda_for_caller = Pubkey::find_program_address(
            &[
                USER_REWARD_INFO_SEEDS,
                folio_key.as_ref(),
                reward_token.key().as_ref(),
                caller_key.as_ref(),
            ],
            &FolioProgram::id(),
        );

        check_condition!(
            caller_reward_info.key() == expected_pda_for_caller.0,
            InvalidUserRewardInfo
        );

        // Fee recipient is the folio's token account
        let fee_recipient_token_account_data = fee_recipient_token_account.try_borrow_data()?;
        let fee_recipient_token_account_parsed =
            TokenAccount::try_deserialize(&mut &fee_recipient_token_account_data[..])?;

        check_condition!(
            fee_recipient_token_account.key()
                == associated_token::get_associated_token_address_with_program_id(
                    &folio_reward_tokens_key,
                    &reward_token.key(),
                    &token_program_id,
                ),
            InvalidFeeRecipientTokenAccount
        );

        // Accrue rewards on reward info
        let mut reward_info: Account<RewardInfo> = Account::try_from(reward_info)?;
        reward_info.accrue_rewards(
            folio_reward_tokens.reward_ratio,
            fee_recipient_token_account_parsed.amount,
            raw_governance_staked_token_account_balance,
            governance_token_decimals,
            current_time,
        )?;

        // Init if needed and accrue rewards on user reward info
        let raw_caller_governance_account_balance = GovernanceUtil::get_governance_account_balance(
            &ctx.accounts.caller_governance_token_account,
            &realm_key,
            &governance_token_mint_key,
            &caller_key,
        )?;

        UserRewardInfo::process_init_if_needed(
            caller_reward_info,
            &ctx.accounts.system_program,
            &ctx.accounts.caller,
            ctx.accounts.caller.key,
            expected_pda_for_caller.1,
            &folio_key,
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
                &FolioProgram::id(),
            )?;

            let expected_pda_for_user = Pubkey::find_program_address(
                &[
                    USER_REWARD_INFO_SEEDS,
                    folio_key.as_ref(),
                    reward_token.key().as_ref(),
                    user_key.as_ref(),
                ],
                &FolioProgram::id(),
            );

            check_condition!(
                user_reward_info.key() == expected_pda_for_user.0,
                InvalidUserRewardInfo
            );

            // Create the user reward info if it doesn't exist and accrue rewards on user reward info

            let raw_user_governance_account_balance =
                GovernanceUtil::get_governance_account_balance(
                    &ctx.accounts.user_governance_token_account,
                    &realm_key,
                    &governance_token_mint_key,
                    &user_key,
                )?;

            UserRewardInfo::process_init_if_needed(
                user_reward_info,
                &ctx.accounts.system_program,
                &ctx.accounts.caller,
                &user_key,
                expected_pda_for_user.1,
                &folio_key,
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
