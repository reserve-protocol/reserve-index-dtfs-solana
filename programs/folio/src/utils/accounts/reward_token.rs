use crate::events::RewardRatioSet;
use crate::state::FolioRewardTokens;
use crate::utils::{Decimal, Rounding};
use anchor_lang::prelude::*;
use shared::check_condition;
use shared::constants::{LN_2, MAX_REWARD_HALF_LIFE, MIN_REWARD_HALF_LIFE};
use shared::errors::ErrorCode;

impl FolioRewardTokens {
    /// Process the init if needed, meaning we initialize the account if it's not initialized yet and if it already is
    /// we check if the bump is correct.
    ///
    /// # Arguments
    /// * `account_loader_folio_reward_tokens` - The account loader for the FolioRewardTokens account.
    /// * `context_bump` - The bump of the account provided in the anchor context.
    /// * `folio` - The folio
    /// * `new_reward_token` - The new reward token to add (if any)
    /// * `reward_period` - The reward period (seconds)
    #[cfg(not(tarpaulin_include))]
    pub fn process_init_if_needed(
        account_loader_folio_reward_tokens: &mut AccountLoader<FolioRewardTokens>,
        context_bump: u8,
        folio: &Pubkey,
        new_reward_token: Option<&Pubkey>,
        reward_period: u64,
    ) -> Result<()> {
        let account_info_folio_reward_tokens = account_loader_folio_reward_tokens.to_account_info();

        let data = account_info_folio_reward_tokens.try_borrow_mut_data()?;
        let mut disc_bytes = [0u8; 8];
        disc_bytes.copy_from_slice(&data[..8]);

        let discriminator = u64::from_le_bytes(disc_bytes);

        drop(data);

        if discriminator == 0 {
            // Not initialized yet
            let folio_reward_tokens = &mut account_loader_folio_reward_tokens.load_init()?;

            folio_reward_tokens.bump = context_bump;
            folio_reward_tokens.folio = *folio;
            if let Some(new_reward_token) = new_reward_token {
                folio_reward_tokens.add_reward_token(new_reward_token)?;
            }
            folio_reward_tokens.set_reward_ratio(reward_period)?;
        } else {
            let folio_reward_tokens = &mut account_loader_folio_reward_tokens.load_mut()?;

            check_condition!(folio_reward_tokens.bump == context_bump, InvalidBump);

            if let Some(new_reward_token) = new_reward_token {
                folio_reward_tokens.add_reward_token(new_reward_token)?;
            }
            folio_reward_tokens.set_reward_ratio(reward_period)?;
        }

        Ok(())
    }

    /// Add a reward token to the FolioRewardTokens account, meaning we'll start tracking that reward token.
    /// Will return an error if the reward token is already registered or if it's a disallowed reward token or if there is no more room for new reward tokens.
    ///
    /// # Arguments
    /// * `new_reward_token` - The new reward token to add.
    pub fn add_reward_token(&mut self, new_reward_token: &Pubkey) -> Result<()> {
        // Check for disallowed reward token
        check_condition!(
            !self
                .disallowed_token
                .iter()
                .any(|disallowed_reward_token| disallowed_reward_token.key() == *new_reward_token),
            DisallowedRewardToken
        );

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

    /// Remove a reward token from the FolioRewardTokens account, meaning we'll stop tracking that reward token.
    /// Will return an error if the reward token is not registered.
    /// Will add the removed reward token to the disallowed token list.
    ///
    /// # Arguments
    /// * `reward_token` - The reward token to remove.
    pub fn remove_reward_token(&mut self, reward_token: &Pubkey) -> Result<()> {
        let reward_token_position = self
            .reward_tokens
            .iter()
            .position(|reward_token_iter| reward_token_iter.key() == *reward_token);

        // Check if reward token is registered
        check_condition!(reward_token_position.is_some(), RewardNotRegistered);

        // Set to null in reward token list
        self.reward_tokens[reward_token_position.unwrap()] = Pubkey::default();

        // Add to disallowed token list
        let default_pubkey = Pubkey::default();

        let next_disallowed_token_position = self
            .disallowed_token
            .iter()
            .position(|disallowed_reward_token| disallowed_reward_token.key() == default_pubkey);

        check_condition!(
            next_disallowed_token_position.is_some(),
            NoMoreRoomForNewDisallowedToken
        );

        self.disallowed_token[next_disallowed_token_position.unwrap()] = *reward_token;

        Ok(())
    }

    /// Set the reward ratio for the FolioRewardTokens account.
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
