#[cfg(test)]
mod tests {

    use anchor_lang::prelude::Pubkey;
    use folio::state::FolioRewardTokens;
    use shared::constants::{MAX_REWARD_HALF_LIFE, MAX_REWARD_TOKENS, MIN_REWARD_HALF_LIFE};
    use shared::errors::ErrorCode::*;

    fn setup_folio_reward_tokens() -> FolioRewardTokens {
        FolioRewardTokens {
            bump: 1,
            folio: Pubkey::new_unique(),
            reward_tokens: [Pubkey::default(); MAX_REWARD_TOKENS],
            disallowed_token: [Pubkey::default(); MAX_REWARD_TOKENS],
            reward_ratio: 0,
            _padding: [0; 7],
        }
    }

    #[test]
    fn test_add_reward_token() {
        let mut reward_tokens = setup_folio_reward_tokens();
        let new_token = Pubkey::new_unique();

        let result = reward_tokens.add_reward_token(&new_token);
        assert!(result.is_ok());
        assert_eq!(reward_tokens.reward_tokens[0], new_token);

        let duplicate_result = reward_tokens.add_reward_token(&new_token);
        assert!(duplicate_result.is_err());
        assert_eq!(
            duplicate_result.unwrap_err(),
            RewardAlreadyRegistered.into()
        );
    }

    #[test]
    fn test_add_reward_token_when_full() {
        let mut reward_tokens = setup_folio_reward_tokens();

        for i in 0..MAX_REWARD_TOKENS {
            reward_tokens.reward_tokens[i] = Pubkey::new_unique();
        }

        let new_token = Pubkey::new_unique();
        let result = reward_tokens.add_reward_token(&new_token);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), NoMoreRoomForNewRewardToken.into());
    }

    #[test]
    fn test_add_disallowed_reward_token() {
        let mut reward_tokens = setup_folio_reward_tokens();
        let disallowed_token = Pubkey::new_unique();
        reward_tokens.disallowed_token[0] = disallowed_token;

        let result = reward_tokens.add_reward_token(&disallowed_token);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), DisallowedRewardToken.into());
    }

    #[test]
    fn test_remove_reward_token() {
        let mut reward_tokens = setup_folio_reward_tokens();
        let token_to_remove = Pubkey::new_unique();
        reward_tokens.reward_tokens[0] = token_to_remove;

        let result = reward_tokens.remove_reward_token(&token_to_remove);
        assert!(result.is_ok());
        assert_eq!(reward_tokens.reward_tokens[0], Pubkey::default());
        assert_eq!(reward_tokens.disallowed_token[0], token_to_remove);
    }

    #[test]
    fn test_remove_nonexistent_reward_token() {
        let mut reward_tokens = setup_folio_reward_tokens();
        let nonexistent_token = Pubkey::new_unique();

        let result = reward_tokens.remove_reward_token(&nonexistent_token);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), RewardNotRegistered.into());
    }

    #[test]
    fn test_remove_token_disallowed_list_full() {
        let mut reward_tokens = setup_folio_reward_tokens();
        let token_to_remove = Pubkey::new_unique();
        reward_tokens.reward_tokens[0] = token_to_remove;

        for i in 0..MAX_REWARD_TOKENS {
            reward_tokens.disallowed_token[i] = Pubkey::new_unique();
        }

        let result = reward_tokens.remove_reward_token(&token_to_remove);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), NoMoreRoomForNewDisallowedToken.into());
    }

    #[test]
    fn test_set_reward_ratio() {
        let mut reward_tokens = setup_folio_reward_tokens();

        let result = reward_tokens.set_reward_ratio(MIN_REWARD_HALF_LIFE);
        assert!(result.is_ok());
        assert!(reward_tokens.reward_ratio > 0);

        let result = reward_tokens.set_reward_ratio(MAX_REWARD_HALF_LIFE);
        assert!(result.is_ok());
        assert!(reward_tokens.reward_ratio > 0);
    }

    #[test]
    fn test_set_reward_ratio_invalid_values() {
        let mut reward_tokens = setup_folio_reward_tokens();

        let result = reward_tokens.set_reward_ratio(MIN_REWARD_HALF_LIFE - 1);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), InvalidRewardHalfLife.into());

        let result = reward_tokens.set_reward_ratio(MAX_REWARD_HALF_LIFE + 1);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), InvalidRewardHalfLife.into());
    }
}
