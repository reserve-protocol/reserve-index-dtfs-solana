use crate::program::Folio as FolioProgram;
use crate::state::{Actor, Folio, FolioRewardTokens, RewardInfo, UserRewardInfo};
use crate::utils::account_util::next_account;
use crate::utils::structs::{FolioStatus, Role};
use crate::GovernanceUtil;
use anchor_lang::prelude::*;
use anchor_spl::associated_token::{self};
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use shared::check_condition;
use shared::constants::{ACTOR_SEEDS, SPL_GOVERNANCE_PROGRAM_ID};
use shared::constants::{FOLIO_REWARD_TOKENS_SEEDS, REWARD_INFO_SEEDS, USER_REWARD_INFO_SEEDS};
use shared::errors::ErrorCode;

const REMAINING_ACCOUNT_DIVIDER_FOR_CALLER: usize = 5;
const REMAINING_ACCOUNT_DIVIDER_FOR_USER: usize = 7;

#[derive(Accounts)]
pub struct AccrueRewards<'info> {
    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,

    #[account(mut)]
    pub caller: Signer<'info>,

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

    /// CHECK: User's token account
    #[account()]
    pub user: UncheckedAccount<'info>,
    /*
    Remaining accounts are

    - Reward token mint
    - Reward info for the token mint (mut)
    - Fee recipient token account (needs to be the FOLIO TOKEN REWARDS' token account, not the DAO's)
    - User reward info for CALLER (mut)
    - User governance account for staked amount
    - User reward info for USER **IF USER IS NOT CALLER** (mut)
    - User governance account for staked amount **IF USER IS NOT CALLER**
     */
}

impl AccrueRewards<'_> {
    pub fn validate(&self, folio: &Folio) -> Result<()> {
        folio.validate_folio(
            &self.folio.key(),
            Some(&self.actor),
            Some(Role::Owner),
            Some(vec![FolioStatus::Initializing, FolioStatus::Initialized]),
        )?;

        // Leaving here to show it's not something I forgot, but it's already validateed when we get the deposit balances
        // for the users claiming.
        //
        // Validate that the folio owner is a realm
        // GovernanceUtil::folio_owner_is_realm(&self.folio_owner)?;

        Ok(())
    }
}

// This might need to be called multiple times if there are a lot of reward tokens
// And because of the intense CU requirements, we might need to do it for a small subset of reward tokens
pub fn handler<'info>(ctx: Context<'_, '_, 'info, 'info, AccrueRewards<'info>>) -> Result<()> {
    let folio_key = ctx.accounts.folio.key();
    let folio_reward_tokens_key = ctx.accounts.folio_reward_tokens.key();
    let caller_key = ctx.accounts.caller.key();
    let user_key = ctx.accounts.user.key();
    let token_program_id = ctx.accounts.token_program.key();
    let current_time = Clock::get()?.unix_timestamp as u64;

    // The folio owner is the realm (DAO)
    let realm_key = ctx.accounts.folio_owner.key();

    let folio = ctx.accounts.folio.load()?;
    ctx.accounts.validate(&folio)?;

    let folio_token_mint = folio.folio_token_mint;

    let folio_reward_tokens = ctx.accounts.folio_reward_tokens.load()?;

    let remaining_account_divider = if ctx.accounts.user.key() == ctx.accounts.caller.key() {
        REMAINING_ACCOUNT_DIVIDER_FOR_CALLER
    } else {
        REMAINING_ACCOUNT_DIVIDER_FOR_USER
    };

    // Either REMAINING_ACCOUNT_DIVIDER_FOR_CALLER if user == caller, or REMAINING_ACCOUNT_DIVIDER_FOR_USER if user != caller
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
        let fee_recipient_token_account = next_account(
            &mut remaining_accounts_iter,
            false,
            false,
            &token_program_id,
        )?; // Folio token rewards' token account
        let caller_reward_info = next_account(
            &mut remaining_accounts_iter,
            false,
            true,
            &FolioProgram::id(),
        )?;
        let caller_governance_account = next_account(
            &mut remaining_accounts_iter,
            false,
            false,
            &SPL_GOVERNANCE_PROGRAM_ID,
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

        let data = reward_token.try_borrow_data()?;
        let mint = Mint::try_deserialize(&mut &data[..])?;

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
            folio_reward_tokens.reward_ratio.to_u256(),
            fee_recipient_token_account_parsed.amount,
            mint.supply,
            mint.decimals as u64,
            current_time,
        )?;

        // Init if needed and accrue rewards on user reward info
        let caller_governance_account_balance = GovernanceUtil::get_governance_account_balance(
            caller_governance_account,
            &realm_key,
            &folio_token_mint,
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
            caller_governance_account_balance,
        )?;

        // All the logic for the extra user if user != caller
        if remaining_account_divider == REMAINING_ACCOUNT_DIVIDER_FOR_USER {
            let user_reward_info = next_account(
                &mut remaining_accounts_iter,
                false,
                true,
                &FolioProgram::id(),
            )?;
            let user_governance_account = next_account(
                &mut remaining_accounts_iter,
                false,
                false,
                &SPL_GOVERNANCE_PROGRAM_ID,
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
            let user_governance_account_balance = GovernanceUtil::get_governance_account_balance(
                user_governance_account,
                &realm_key,
                &folio_token_mint,
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
                user_governance_account_balance,
            )?;
        }

        // Serialize back all the accounts
        let reward_info_account_info = reward_info.to_account_info();
        let reward_info_data = &mut **reward_info_account_info.try_borrow_mut_data()?;
        reward_info.try_serialize(&mut &mut reward_info_data[..])?;
    }

    Ok(())
}
