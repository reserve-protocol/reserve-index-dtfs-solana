use crate::program::Folio as FolioProgram;
use crate::state::{Actor, Folio, FolioRewardTokens, ProgramRegistrar, RewardInfo, UserRewardInfo};
use anchor_lang::prelude::*;
use anchor_spl::associated_token::{self};
use anchor_spl::token_interface;
use anchor_spl::token_interface::{Mint, TokenInterface, TransferChecked};
use shared::check_condition;
use shared::constants::{ACTOR_SEEDS, DTF_PROGRAM_SIGNER_SEEDS, PROGRAM_REGISTRAR_SEEDS};
use shared::constants::{FOLIO_REWARD_TOKENS_SEEDS, REWARD_INFO_SEEDS, USER_REWARD_INFO_SEEDS};
use shared::errors::ErrorCode;
use shared::structs::{FolioStatus, Role};

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
    Account to validate
    */
    #[account(
        seeds = [PROGRAM_REGISTRAR_SEEDS],
        bump = program_registrar.bump
    )]
    pub program_registrar: Box<Account<'info, ProgramRegistrar>>,

    #[account(
        seeds = [DTF_PROGRAM_SIGNER_SEEDS],
        bump,
        seeds::program = dtf_program.key(),
    )]
    pub dtf_program_signer: Signer<'info>,

    /// CHECK: DTF program used for creating owner record
    #[account()]
    pub dtf_program: UncheckedAccount<'info>,

    /// CHECK: DTF program data to validate program deployment slot
    #[account()]
    pub dtf_program_data: UncheckedAccount<'info>,
    /*
    Remaining accounts are

    - Reward token mint
    - Fee recipient reward token account (mut) (to send) (IS NOT THE DAO's TOKEN ACCOUNTS, it's the folio token rewards' token account)
    - Reward info for the token mint (mut)
    - User reward info (mut)
    - User reward token account (mut) (to receive)
     */
}

impl ClaimRewards<'_> {
    pub fn validate(&self, folio: &Folio) -> Result<()> {
        folio.validate_folio_program_post_init(
            &self.folio.key(),
            Some(&self.program_registrar),
            Some(&self.dtf_program),
            Some(&self.dtf_program_data),
            None,
            None,
            Some(vec![FolioStatus::Initializing, FolioStatus::Initialized]),
        )?;

        // Validate that the folio owner is the correct one
        check_condition!(
            Role::has_role(self.actor.roles, Role::Owner),
            InvalidFolioOwner
        );

        // Validated via the other pdas
        // Validate that the folio owner is a realm
        //GovernanceUtil::folio_owner_is_realm(&self.folio_owner)?;

        Ok(())
    }
}

/*
In the solana version, we won't call accrue rewards on claim, as it'll implode the CU.
*/
pub fn handler<'info>(ctx: Context<'_, '_, 'info, 'info, ClaimRewards<'info>>) -> Result<()> {
    let folio_reward_tokens_key = ctx.accounts.folio_reward_tokens.key();
    let folio_key = ctx.accounts.folio.key();
    let user_key = ctx.accounts.user.key();

    let folio = ctx.accounts.folio.load()?;
    ctx.accounts.validate(&folio)?;

    let folio_reward_tokens = ctx.accounts.folio_reward_tokens.load()?;

    let folio_reward_tokens_seeds = &[
        FOLIO_REWARD_TOKENS_SEEDS,
        folio_key.as_ref(),
        &[folio_reward_tokens.bump],
    ];

    let signer_seeds = &[&folio_reward_tokens_seeds[..]];

    check_condition!(
        ctx.remaining_accounts.len() % 5 == 0,
        InvalidNumberOfRemainingAccounts
    );

    let mut remaining_accounts_iter = ctx.remaining_accounts.iter();

    for _ in 0..ctx.remaining_accounts.len() / 5 {
        let reward_token = remaining_accounts_iter.next().unwrap();
        // This is the folio reward tokens' token account, not the DAO's
        let fee_recipient_token_account = remaining_accounts_iter.next().unwrap(); // Sender
        let reward_info = remaining_accounts_iter.next().unwrap();
        let user_reward_info = remaining_accounts_iter.next().unwrap();
        let user_reward_token_account = remaining_accounts_iter.next().unwrap(); // Receiver

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
                == associated_token::get_associated_token_address(
                    &folio_reward_tokens_key,
                    &reward_token.key(),
                ),
            InvalidFeeRecipientTokenAccount
        );

        // Update the accounts
        let mut reward_info: Account<RewardInfo> = Account::try_from(reward_info)?;
        let mut user_reward_info: Account<UserRewardInfo> = Account::try_from(user_reward_info)?;

        let claimable_rewards = user_reward_info.accrued_rewards;

        reward_info.total_claimed = reward_info
            .total_claimed
            .checked_add(claimable_rewards)
            .unwrap();

        user_reward_info.accrued_rewards = 0;

        if claimable_rewards > 0 {
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
                claimable_rewards,
                mint.decimals,
            )?;
        }
    }

    Ok(())
}
