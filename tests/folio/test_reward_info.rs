#[cfg(test)]
mod tests {

    use anchor_lang::prelude::Pubkey;
    use folio::state::RewardInfo;
    use shared::constants::{LN_2, MIN_REWARD_HALF_LIFE};
    use shared::errors::ErrorCode::MathOverflow;
    use shared::util::math_util::U256Number;
    use spl_math::uint::U256;

    fn setup_reward_info() -> RewardInfo {
        RewardInfo {
            bump: 1,
            folio: Pubkey::new_unique(),
            folio_reward_token: Pubkey::new_unique(),
            payout_last_paid: 1000,
            reward_index: U256Number::ZERO,
            balance_accounted: 100,
            balance_last_known: 1000,
            total_claimed: 0,
        }
    }

    #[test]
    fn test_accrue_rewards_zero_elapsed() {
        let mut reward_info = setup_reward_info();
        reward_info.payout_last_paid = 1000;

        let result = reward_info.accrue_rewards(
            U256::from(LN_2)
                .checked_div(U256::from(MIN_REWARD_HALF_LIFE))
                .unwrap(),
            2000,
            1000,
            18,
            1000,
        );
        assert!(result.is_ok());
        assert_eq!(reward_info.balance_last_known, 1000);
    }

    #[test]
    fn test_accrue_rewards_with_zero_supply() {
        let mut reward_info = setup_reward_info();
        reward_info.payout_last_paid = 900;

        let result = reward_info.accrue_rewards(
            U256::from(LN_2)
                .checked_div(U256::from(MIN_REWARD_HALF_LIFE))
                .unwrap(),
            2000,
            0,
            18,
            1001,
        );

        assert!(result.is_ok());
        assert_eq!(reward_info.balance_accounted, 100);
        assert_eq!(reward_info.balance_last_known, 2000);
    }

    #[test]
    fn test_accrue_rewards_with_claimed_tokens() {
        let mut reward_info = setup_reward_info();
        reward_info.total_claimed = 500;
        reward_info.payout_last_paid = 900;

        let result = reward_info.accrue_rewards(
            U256::from(LN_2)
                .checked_div(U256::from(MIN_REWARD_HALF_LIFE))
                .unwrap(),
            2000,
            1000,
            18,
            1001,
        );
        assert!(result.is_ok());
        assert_eq!(reward_info.balance_last_known, 2500);
    }

    #[test]
    fn test_accrue_rewards_overflow_conditions() {
        let mut reward_info = setup_reward_info();
        reward_info.balance_last_known = u64::MAX;
        reward_info.total_claimed = 1;

        let result = reward_info.accrue_rewards(
            U256::from(LN_2)
                .checked_div(U256::from(MIN_REWARD_HALF_LIFE))
                .unwrap(),
            u64::MAX,
            1000,
            18,
            1001,
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_calculate_delta_index() {
        let mut reward_info = setup_reward_info();

        let result = reward_info.calculate_delta_index(1000, 1000, 18);
        assert!(result.is_ok());
        assert!(!reward_info.reward_index.to_u256().is_zero());
    }

    #[test]
    fn test_calculate_delta_index_with_zero_supply() {
        let mut reward_info = setup_reward_info();

        let result = reward_info.calculate_delta_index(1000, 0, 18);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), MathOverflow.into());
    }

    #[test]
    fn test_calculate_delta_index_overflow() {
        let mut reward_info = setup_reward_info();

        let result = reward_info.calculate_delta_index(u128::MAX, u64::MAX, u64::MAX);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), MathOverflow.into());
    }

    #[test]
    fn test_calculate_delta_index_large_decimals() {
        let mut reward_info = setup_reward_info();

        let result = reward_info.calculate_delta_index(1000, 1000, 30);
        assert!(result.is_ok());
        assert!(!reward_info.reward_index.to_u256().is_zero());
    }
}
