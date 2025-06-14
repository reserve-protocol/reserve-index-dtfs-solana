use crate::events::RewardRatioSet;
use crate::state::{RewardInfo, RewardTokens};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::TokenAccount;
use shared::check_condition;
use shared::constants::{LN_2, MAX_REWARD_HALF_LIFE, MIN_REWARD_HALF_LIFE};
use shared::errors::ErrorCode;
use shared::utils::{Decimal, Rounding};

impl RewardTokens {
    /// Process the init if needed, meaning we initialize the account if it's not initialized yet and if it already is
    /// we check if the bump is correct.
    ///
    /// # Arguments
    /// * `account_loader_reward_tokens` - The account loader for the RewardTokens account.
    /// * `context_bump` - The bump of the account provided in the anchor context.
    /// * `realm` - The realm the RewardTokens account belongs to.
    /// * `rewards_admin` - The rewards admin account.
    #[cfg(not(tarpaulin_include))]
    pub fn process_init_if_needed(
        account_loader_reward_tokens: &mut AccountLoader<RewardTokens>,
        context_bump: u8,
        realm: &Pubkey,
        rewards_admin: &Pubkey,
    ) -> Result<()> {
        let account_info_reward_tokens = account_loader_reward_tokens.to_account_info();

        let data = account_info_reward_tokens.try_borrow_mut_data()?;
        let mut disc_bytes = [0u8; 8];
        disc_bytes.copy_from_slice(&data[..8]);

        let discriminator = u64::from_le_bytes(disc_bytes);

        drop(data);

        if discriminator == 0 {
            // Not initialized yet
            let reward_tokens = &mut account_loader_reward_tokens.load_init()?;

            reward_tokens.bump = context_bump;
            reward_tokens.realm = *realm;
            reward_tokens.rewards_admin = *rewards_admin;
        } else {
            let reward_tokens = &mut account_loader_reward_tokens.load_mut()?;

            check_condition!(reward_tokens.bump == context_bump, InvalidBump);

            reward_tokens.rewards_admin = *rewards_admin;
        }

        Ok(())
    }

    /// Add a reward token to the RewardTokens account, meaning we'll start tracking that reward token.
    /// Will return an error if the reward token is already registered or if it's a disallowed reward token or if there is no more room for new reward tokens.
    ///
    /// # Arguments
    /// * `new_reward_token` - The new reward token to add.
    /// * `new_reward_info` - The new reward info account to add.
    pub fn add_reward_token(
        &mut self,
        new_reward_token: &Pubkey,
        new_reward_info: &RewardInfo,
    ) -> Result<()> {
        // Check for disallowed reward token
        check_condition!(!new_reward_info.is_disallowed, DisallowedRewardToken);

        let mut next_index_to_add: Option<usize> = None;
        for (index, reward_token) in self.reward_tokens.iter().enumerate() {
            check_condition!(
                reward_token.key() != *new_reward_token,
                RewardAlreadyRegistered
            );

            if next_index_to_add.is_none() && reward_token.key() == Pubkey::default() {
                next_index_to_add = Some(index);
            }
        }

        check_condition!(next_index_to_add.is_some(), NoMoreRoomForNewRewardToken);

        self.reward_tokens[next_index_to_add.unwrap()] = *new_reward_token;

        Ok(())
    }

    /// Remove a reward token from the RewardTokens account, meaning we'll stop tracking that reward token.
    /// Will return an error if the reward token is not registered.
    /// Will set the removed reward token to the disallowed state.
    ///
    /// # Arguments
    /// * `reward_token` - The reward token to remove.
    /// * `reward_info` - The reward info account to update.
    #[cfg(not(tarpaulin_include))]
    #[allow(clippy::too_many_arguments)]
    pub fn remove_reward_token<'info>(
        &mut self,
        reward_token: &Pubkey,
        realm: &AccountInfo<'info>,
        governance_token_mint: &AccountInfo<'info>,
        governance_staked_token_account: &AccountInfo<'info>,
        reward_info: &mut Account<RewardInfo>,
        token_rewards_token_account: &InterfaceAccount<'info, TokenAccount>,
        current_time: u64,
    ) -> Result<()> {
        // Get the total balance of staked governance tokens in the Realm
        {
            use crate::utils::GovernanceUtil;
            let (raw_governance_staked_token_account_balance, governance_token_decimals) =
                GovernanceUtil::get_realm_staked_balance_and_mint_decimals(
                    realm,
                    governance_token_mint,
                    governance_staked_token_account,
                )?;

            // Before the removal of rewards accrue_rewards_till_now
            reward_info.accrue_rewards(
                self.reward_ratio,
                token_rewards_token_account.amount,
                raw_governance_staked_token_account_balance,
                governance_token_decimals,
                current_time,
            )?;
        }

        let reward_token_position = self
            .reward_tokens
            .iter()
            .position(|reward_token_iter| reward_token_iter.key() == *reward_token);

        // Check if reward token is registered
        check_condition!(reward_token_position.is_some(), RewardNotRegistered);

        // Set to null in reward token list
        self.reward_tokens[reward_token_position.unwrap()] = Pubkey::default();

        reward_info.is_disallowed = true;

        Ok(())
    }

    /// Set the reward ratio for the RewardTokens account.
    /// Will return an error if the reward half life is not between the minimum and maximum reward half life.
    ///
    /// # Arguments
    /// * `reward_half_life` - The reward half life (seconds).
    pub fn set_reward_ratio(&mut self, reward_half_life: u64) -> Result<()> {
        check_condition!(
            (MIN_REWARD_HALF_LIFE..=MAX_REWARD_HALF_LIFE).contains(&reward_half_life),
            InvalidRewardHalfLife
        );

        // D18{1/s} = D18{1} / {s} (reward_half_life is in seconds, so don't need to scale)
        let scaled_calculated_reward_ratio =
            Decimal::from_scaled(LN_2).div(&Decimal::from_scaled(reward_half_life))?;

        self.reward_ratio = scaled_calculated_reward_ratio.to_scaled(Rounding::Floor)?;

        emit!(RewardRatioSet {
            reward_ratio: self.reward_ratio,
            reward_half_life,
        });

        Ok(())
    }
}
