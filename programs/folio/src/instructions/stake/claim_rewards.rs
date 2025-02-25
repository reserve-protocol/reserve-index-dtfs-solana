use crate::program::Folio as FolioProgram;
use crate::state::{Actor, Folio, FolioRewardTokens, RewardInfo, UserRewardInfo};
use crate::utils::account_util::next_account;
use crate::utils::structs::Role;
use crate::utils::{Decimal, FolioProgramInternal, Rounding};
use anchor_lang::prelude::*;
use anchor_spl::associated_token::{self};
use anchor_spl::token_interface;
use anchor_spl::token_interface::{Mint, TokenInterface, TransferChecked};
use shared::check_condition;
use shared::constants::{ACTOR_SEEDS, D9_U128};
use shared::constants::{FOLIO_REWARD_TOKENS_SEEDS, REWARD_INFO_SEEDS, USER_REWARD_INFO_SEEDS};
use shared::errors::ErrorCode;

const REMAINING_ACCOUNTS_DIVIDER: usize = 5;
const REMAINING_ACCOUNTS_UPPER_INDEX_FOR_ACCRUE_REWARDS: usize = 4;

#[derive(Accounts)]
pub struct ClaimRewards<'info> {
    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,

    #[account(mut)]
    pub user: Signer<'info>,

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
    /*
    Remaining accounts are

    - Reward token mint
    - Reward info for the token mint (mut)
    - Fee recipient reward token account (mut) (to send) (IS NOT THE DAO's TOKEN ACCOUNTS, it's the folio token rewards' token account)
    - User reward info (mut)
    - User reward token account (mut) (to receive)
     */
}

impl ClaimRewards<'_> {
    pub fn validate(&self, folio: &Folio) -> Result<()> {
        folio.validate_folio(
            &self.folio.key(),
            Some(&self.actor),
            Some(vec![Role::Owner]),
            None,
        )?;

        Ok(())
    }
}

pub fn handler<'info>(ctx: Context<'_, '_, 'info, 'info, ClaimRewards<'info>>) -> Result<()> {
    let folio_reward_tokens_key = ctx.accounts.folio_reward_tokens.key();
    let folio_key = ctx.accounts.folio.key();
    let user_key = ctx.accounts.user.key();
    let token_program_id = ctx.accounts.token_program.key();

    let folio = ctx.accounts.folio.load()?;
    ctx.accounts.validate(&folio)?;

    check_condition!(
        ctx.remaining_accounts.len() % REMAINING_ACCOUNTS_DIVIDER == 0,
        InvalidNumberOfRemainingAccounts
    );

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
        &ctx.accounts.user,
        &ctx.accounts.caller_governance_token_account,
        &ctx.accounts.folio_reward_tokens,
        // Only the first 4 accounts are needed for the accrue rewards instruction, the last one is for claim only
        &ctx.remaining_accounts[0..REMAINING_ACCOUNTS_UPPER_INDEX_FOR_ACCRUE_REWARDS],
        true,
    )?;

    // Proceed with the claim rewards
    let folio_reward_tokens = ctx.accounts.folio_reward_tokens.load()?;

    let folio_reward_tokens_seeds = &[
        FOLIO_REWARD_TOKENS_SEEDS,
        folio_key.as_ref(),
        &[folio_reward_tokens.bump],
    ];

    let signer_seeds = &[&folio_reward_tokens_seeds[..]];

    let mut remaining_accounts_iter = ctx.remaining_accounts.iter();

    for _ in 0..ctx.remaining_accounts.len() / REMAINING_ACCOUNTS_DIVIDER {
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
        // This is the folio reward tokens' token account, not the DAO's
        let fee_recipient_token_account =
            next_account(&mut remaining_accounts_iter, false, true, &token_program_id)?;
        let user_reward_info = next_account(
            &mut remaining_accounts_iter,
            false,
            true,
            &FolioProgram::id(),
        )?;
        let user_reward_token_account =
            next_account(&mut remaining_accounts_iter, false, true, &token_program_id)?;

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

        let data = reward_token.try_borrow_data()?;
        let mint = Mint::try_deserialize(&mut &data[..])?;

        check_condition!(
            fee_recipient_token_account.key()
                == associated_token::get_associated_token_address_with_program_id(
                    &folio_reward_tokens_key,
                    &reward_token.key(),
                    &token_program_id,
                ),
            InvalidFeeRecipientTokenAccount
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

        // Add the amount withot dust as claimed
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

        // Send the rewards to the user
        let cpi_accounts = TransferChecked {
            from: fee_recipient_token_account.to_account_info(),
            to: user_reward_token_account.to_account_info(),
            authority: ctx.accounts.folio_reward_tokens.to_account_info(),
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
