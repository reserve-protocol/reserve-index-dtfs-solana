//! Tests for the RewardToken state

#[cfg(test)]
mod tests {

    use anchor_lang::prelude::Pubkey;
    use rewards::state::{RewardInfo, RewardTokens};
    use shared::constants::{MAX_REWARD_HALF_LIFE, MAX_REWARD_TOKENS, MIN_REWARD_HALF_LIFE};
    use shared::errors::ErrorCode::*;

    fn setup_reward_tokens() -> RewardTokens {
        RewardTokens {
            bump: 1,
            realm: Pubkey::new_unique(),
            rewards_admin: Pubkey::new_unique(),
            reward_tokens: [Pubkey::default(); MAX_REWARD_TOKENS],
            reward_ratio: 0,
            _padding: [0; 15],
        }
    }

    fn setup_reward_info(token: Pubkey, is_disallowed: bool) -> RewardInfo {
        RewardInfo {
            reward_token: token,
            is_disallowed,
            ..Default::default()
        }
    }

    #[test]
    fn test_add_reward_token() {
        let mut reward_tokens = setup_reward_tokens();
        let new_token = Pubkey::new_unique();
        let reward_info = setup_reward_info(new_token, false);
        let result = reward_tokens.add_reward_token(&new_token, &reward_info);
        assert!(result.is_ok());
        assert_eq!(reward_tokens.reward_tokens[0], new_token);

        let duplicate_result = reward_tokens.add_reward_token(&new_token, &reward_info);
        assert!(duplicate_result.is_err());
        assert_eq!(
            duplicate_result.unwrap_err(),
            RewardAlreadyRegistered.into()
        );
    }

    #[test]
    fn test_add_reward_token_when_full() {
        let mut reward_tokens = setup_reward_tokens();

        for i in 0..MAX_REWARD_TOKENS {
            reward_tokens.reward_tokens[i] = Pubkey::new_unique();
        }

        let new_token = Pubkey::new_unique();
        let reward_info = setup_reward_info(new_token, false);
        let result = reward_tokens.add_reward_token(&new_token, &reward_info);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), NoMoreRoomForNewRewardToken.into());
    }

    #[test]
    fn test_add_disallowed_reward_token() {
        let mut reward_tokens = setup_reward_tokens();
        let disallowed_token = Pubkey::new_unique();
        let reward_info = setup_reward_info(disallowed_token, true);

        let result = reward_tokens.add_reward_token(&disallowed_token, &reward_info);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), DisallowedRewardToken.into());
    }

    #[test]
    fn test_set_reward_ratio() {
        let mut reward_tokens = setup_reward_tokens();

        let result = reward_tokens.set_reward_ratio(MIN_REWARD_HALF_LIFE);
        // ln(2) / 86400 ~= 8_022_536_812_036
        assert!(result.is_ok());
        assert!(reward_tokens.reward_ratio == 8_022_536_812_036u128);

        // ln(2) / (1209600) ~= 573_038_343_716
        let result = reward_tokens.set_reward_ratio(MAX_REWARD_HALF_LIFE);

        assert!(result.is_ok());
        assert!(reward_tokens.reward_ratio == 573_038_343_716u128);
    }

    #[test]
    fn test_set_reward_ratio_invalid_values() {
        let mut reward_tokens = setup_reward_tokens();

        let result = reward_tokens.set_reward_ratio(MIN_REWARD_HALF_LIFE - 1);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), InvalidRewardHalfLife.into());

        let result = reward_tokens.set_reward_ratio(MAX_REWARD_HALF_LIFE + 1);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), InvalidRewardHalfLife.into());
    }
}
