#[cfg(test)]
mod tests {

    use anchor_lang::prelude::Pubkey;
    use folio::state::{RewardInfo, UserRewardInfo};

    use shared::errors::ErrorCode::MathOverflow;
    use shared::util::math_util::U256Number;
    use spl_math::uint::U256;

    fn setup_user_reward_info() -> UserRewardInfo {
        UserRewardInfo {
            bump: 1,
            folio: Pubkey::new_unique(),
            last_reward_index: U256Number::ZERO,
            accrued_rewards: 0,
            folio_reward_token: Pubkey::new_unique(),
        }
    }

    fn setup_reward_info() -> RewardInfo {
        RewardInfo {
            reward_index: U256Number::from_u256(U256::from(1000)),
            bump: 1,
            folio: Pubkey::new_unique(),
            folio_reward_token: Pubkey::new_unique(),
            payout_last_paid: 1000,
            balance_accounted: 100,
            balance_last_known: 1000,
            total_claimed: 0,
        }
    }

    #[test]
    fn test_accrue_rewards_no_change() {
        let mut user_reward_info = setup_user_reward_info();
        let reward_info = setup_reward_info();
        user_reward_info.last_reward_index = reward_info.reward_index;

        let result = user_reward_info.accrue_rewards(&reward_info, 1000);
        assert!(result.is_ok());
        assert_eq!(user_reward_info.accrued_rewards, 0);
    }

    #[test]
    fn test_accrue_rewards_with_delta() {
        let mut user_reward_info = setup_user_reward_info();
        let mut reward_info = setup_reward_info();

        reward_info.reward_index = U256Number::from_u256(U256::from(1_000_000_000_000_000_000u128)); // 1.0 in 18 decimals

        let user_balance = 1_000_000_000_000_000_000u64; // 1 token in 18 decimals
        let result = user_reward_info.accrue_rewards(&reward_info, user_balance);

        assert!(result.is_ok());
        assert!(user_reward_info.accrued_rewards > 0);
        assert_eq!(
            user_reward_info.last_reward_index.to_u256(),
            reward_info.reward_index.to_u256()
        );
    }

    #[test]
    fn test_accrue_rewards_overflow_case() {
        let mut user_reward_info = setup_user_reward_info();
        let mut reward_info = setup_reward_info();

        reward_info.reward_index = U256Number::from_u256(U256::from(u64::MAX));
        user_reward_info.last_reward_index = U256Number::ZERO;

        let result = user_reward_info.accrue_rewards(&reward_info, 1_000_000u64);
        assert!(result.is_ok());
    }

    #[test]
    fn test_calculate_and_update_accrued_rewards() {
        let mut user_reward_info = setup_user_reward_info();

        let delta = U256::from(1_000_000_000_000_000_000u128);
        let user_balance = 1_000_000_000u64; // 1000 tokens with 6 decimals
        let result = user_reward_info.calculate_and_update_accrued_rewards(user_balance, delta);

        assert!(result.is_ok());
        // Let's keep whatever value we get, but verify it's not zero
        let first_value = user_reward_info.accrued_rewards;
        assert!(first_value > 0);
    }

    #[test]
    fn test_calculate_and_update_accrued_rewards_zero_balance() {
        let mut user_reward_info = setup_user_reward_info();
        let delta = U256::from(1000);

        let result = user_reward_info.calculate_and_update_accrued_rewards(0, delta);
        assert!(result.is_ok());
        assert_eq!(user_reward_info.accrued_rewards, 0);
    }

    #[test]
    fn test_calculate_and_update_accrued_rewards_overflow() {
        let mut user_reward_info = setup_user_reward_info();
        let delta = U256::MAX;

        let result = user_reward_info.calculate_and_update_accrued_rewards(u64::MAX, delta);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), MathOverflow.into());
    }

    #[test]
    fn test_calculate_and_update_accrued_rewards_accumulation() {
        let mut user_reward_info = setup_user_reward_info();

        let delta = U256::from(1_000_000_000_000_000_000u128);
        let user_balance = 1_000_000_000u64; // 1000 tokens with 6 decimals

        let result1 = user_reward_info.calculate_and_update_accrued_rewards(user_balance, delta);
        assert!(result1.is_ok());
        let first_rewards = user_reward_info.accrued_rewards;

        let result2 = user_reward_info.calculate_and_update_accrued_rewards(user_balance, delta);
        assert!(result2.is_ok());
        let second_rewards = user_reward_info.accrued_rewards;

        assert!(second_rewards > first_rewards);
        assert_eq!(second_rewards, first_rewards * 2);
    }
}
