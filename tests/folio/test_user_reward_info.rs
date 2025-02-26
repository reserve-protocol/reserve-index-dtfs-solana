//! Tests for the UserRewardInfo state

#[cfg(test)]
mod tests {
    use anchor_lang::prelude::Pubkey;
    use folio::state::{RewardInfo, UserRewardInfo};

    #[test]
    fn test_accrue_rewards() {
        let mut user_reward_info = UserRewardInfo {
            bump: 1,
            folio: Pubkey::new_unique(),
            folio_reward_token: Pubkey::new_unique(),
            last_reward_index: 0,
            accrued_rewards: 0,
        };

        let reward_info = RewardInfo {
            reward_index: 2_000000000000000000u128, // 2 * D18
            ..RewardInfo::default()
        };

        // Test with 1 token (D9)
        user_reward_info
            .accrue_rewards(&reward_info, 1_000000000)
            .unwrap();

        // Expected: 1 token * 2 D18 = 2 * D18
        assert_eq!(user_reward_info.accrued_rewards, 2_000000000000000000);
        assert_eq!(user_reward_info.last_reward_index, reward_info.reward_index);
    }

    #[test]
    fn test_accrue_rewards_multiple_updates() {
        let mut user_reward_info = UserRewardInfo {
            bump: 1,
            folio: Pubkey::new_unique(),
            folio_reward_token: Pubkey::new_unique(),
            last_reward_index: 1_000000000000000000u128, // 1 * D18
            accrued_rewards: 1_000000000000000000u128,   // 1 * D18
        };

        let reward_info = RewardInfo {
            reward_index: 3_000000000000000000u128, // 3 * D18
            ..RewardInfo::default()
        };

        // Test with 2 tokens (D9)
        user_reward_info
            .accrue_rewards(&reward_info, 2_000000000)
            .unwrap();

        // Previous rewards: 1 * D18
        // New rewards: 2 tokens * (3 - 1) D18 = 4 * D18
        // Total expected: 5 * D18
        assert_eq!(user_reward_info.accrued_rewards, 5_000000000000000000);
        assert_eq!(user_reward_info.last_reward_index, reward_info.reward_index);
    }

    #[test]
    fn test_accrue_rewards_zero_balance() {
        let mut user_reward_info = UserRewardInfo {
            bump: 1,
            folio: Pubkey::new_unique(),
            folio_reward_token: Pubkey::new_unique(),
            last_reward_index: 1_000000000000000000u128,
            accrued_rewards: 1_000000000000000000u128,
        };

        let reward_info = RewardInfo {
            reward_index: 2_000000000000000000u128,
            ..RewardInfo::default()
        };

        // Test with 0 tokens
        user_reward_info.accrue_rewards(&reward_info, 0).unwrap();

        // Should not change accrued rewards when balance is 0
        assert_eq!(user_reward_info.accrued_rewards, 1_000000000000000000);
        assert_eq!(user_reward_info.last_reward_index, reward_info.reward_index);
    }

    #[test]
    fn test_accrue_rewards_no_index_change() {
        let mut user_reward_info = UserRewardInfo {
            bump: 1,
            folio: Pubkey::new_unique(),
            folio_reward_token: Pubkey::new_unique(),
            last_reward_index: 1_000000000000000000u128,
            accrued_rewards: 1_000000000000000000u128,
        };

        let reward_info = RewardInfo {
            reward_index: 1_000000000000000000u128, // Same as last_reward_index
            ..RewardInfo::default()
        };

        user_reward_info
            .accrue_rewards(&reward_info, 1_000000000)
            .unwrap();

        // Should not change when reward_index hasn't changed
        assert_eq!(user_reward_info.accrued_rewards, 1_000000000000000000);
        assert_eq!(user_reward_info.last_reward_index, reward_info.reward_index);
    }

    #[test]
    fn test_accrue_rewards_fractional() {
        let mut user_reward_info = UserRewardInfo {
            bump: 1,
            folio: Pubkey::new_unique(),
            folio_reward_token: Pubkey::new_unique(),
            last_reward_index: 0,
            accrued_rewards: 0,
        };

        let reward_info = RewardInfo {
            reward_index: 500000000000000000u128, // 0.5 * D18
            ..RewardInfo::default()
        };

        // Test with 3 tokens (D9)
        user_reward_info
            .accrue_rewards(&reward_info, 3_000000000)
            .unwrap();

        // Expected: 3 tokens * 0.5 D18 = 1.5 * D18
        assert_eq!(user_reward_info.accrued_rewards, 1_500000000000000000);
        assert_eq!(user_reward_info.last_reward_index, reward_info.reward_index);
    }

    #[test]
    fn test_accrue_rewards_overflow() {
        let mut user_reward_info = UserRewardInfo {
            bump: 1,
            folio: Pubkey::new_unique(),
            folio_reward_token: Pubkey::new_unique(),
            last_reward_index: 2_000000000000000000u128,
            accrued_rewards: 0,
        };

        let reward_info = RewardInfo {
            reward_index: 1_000000000000000000u128, // Less than last_reward_index
            ..RewardInfo::default()
        };

        // Should handle overflow gracefully
        user_reward_info
            .accrue_rewards(&reward_info, 1_000000000)
            .unwrap();

        // Should not change when there's an overflow
        assert_eq!(user_reward_info.accrued_rewards, 0);
        assert_eq!(user_reward_info.last_reward_index, 2_000000000000000000u128);
    }
}
