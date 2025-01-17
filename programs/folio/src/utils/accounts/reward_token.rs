use crate::events::RewardRatioSet;
use crate::state::FolioRewardTokens;
use anchor_lang::prelude::*;
use shared::check_condition;
use shared::constants::{LN_2, MAX_REWARD_HALF_LIFE, MIN_REWARD_HALF_LIFE};
use shared::errors::ErrorCode;

impl FolioRewardTokens {
    pub fn process_init_if_needed(
        account_loader_folio_reward_tokens: &mut AccountLoader<FolioRewardTokens>,
        context_bump: u8,
        folio: &Pubkey,
        new_reward_token: &Pubkey,
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
            folio_reward_tokens.add_reward_token(new_reward_token)?;
            folio_reward_tokens.set_reward_ratio(reward_period)?;
        } else {
            let folio_reward_tokens = &mut account_loader_folio_reward_tokens.load_mut()?;

            check_condition!(folio_reward_tokens.bump == context_bump, InvalidBump);

            folio_reward_tokens.add_reward_token(new_reward_token)?;
            folio_reward_tokens.set_reward_ratio(reward_period)?;
        }

        Ok(())
    }

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

    pub fn remove_reward_token(&mut self, reward_token: &Pubkey) -> Result<()> {
        let reward_token_position = self
            .reward_tokens
            .iter()
            .position(|reward_token| reward_token.key() == *reward_token);

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

    fn set_reward_ratio(&mut self, reward_half_life: u64) -> Result<()> {
        check_condition!(
            (MIN_REWARD_HALF_LIFE..=MAX_REWARD_HALF_LIFE).contains(&reward_half_life),
            InvalidRewardHalfLife
        );

        self.reward_ratio = LN_2.checked_div(reward_half_life as u128).unwrap() as u64;

        emit!(RewardRatioSet {
            reward_ratio: self.reward_ratio,
            reward_half_life,
        });

        Ok(())
    }
}
