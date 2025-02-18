#[cfg(test)]
mod tests {
    use folio::{state::RewardInfo, utils::Decimal};

    #[test]
    fn test_accrue_rewards_basic() {
        let mut reward_info = RewardInfo {
            payout_last_paid: 1000,
            balance_last_known: 1_000000000000000000, // 1 * D18
            balance_accounted: 0,
            total_claimed: 0,
            ..RewardInfo::default()
        };

        let result = reward_info.accrue_rewards(
            500000000000000000, // 0.5 * D18 reward ratio
            1_000000000,        // 1 token current balance (D9)
            1_000000000,        // 1 token supply (D9)
            9,                  // decimals
            2000,               // current time (1000 seconds elapsed)
        );

        assert!(result.is_ok());
        assert_eq!(reward_info.payout_last_paid, 2000);
        // Verify balance_accounted increased
        assert!(reward_info.balance_accounted > 0);
        // Verify reward_index increased
        assert!(reward_info.reward_index > 0);
    }

    #[test]
    fn test_accrue_rewards_no_elapsed_time() {
        let mut reward_info = RewardInfo {
            payout_last_paid: 1000,
            balance_last_known: 1_000000000000000000,
            ..RewardInfo::default()
        };

        let result = reward_info.accrue_rewards(
            500000000000000000,
            1_000000000,
            1_000000000,
            9,
            1000, // Same as payout_last_paid
        );

        assert!(result.is_ok());
        assert_eq!(reward_info.balance_accounted, 0);
        assert_eq!(reward_info.reward_index, 0);
    }

    #[test]
    fn test_accrue_rewards_zero_supply() {
        let mut reward_info = RewardInfo {
            payout_last_paid: 1000,
            balance_last_known: 1_000000000000000000,
            ..RewardInfo::default()
        };

        let result = reward_info.accrue_rewards(
            500000000000000000,
            1_000000000,
            0, // Zero supply
            9,
            2000,
        );

        assert!(result.is_ok());
        // Should update balance_last_known but not calculate rewards
        assert!(reward_info.balance_last_known > 0);
        assert_eq!(reward_info.reward_index, 0);
    }

    #[test]
    fn test_accrue_rewards_with_claimed() {
        let mut reward_info = RewardInfo {
            payout_last_paid: 1000,
            balance_last_known: 1_000000000000000000,
            total_claimed: 500000000000000000, // 0.5 * D18 claimed
            ..RewardInfo::default()
        };

        let result =
            reward_info.accrue_rewards(500000000000000000, 1_000000000, 1_000000000, 9, 2000);

        assert!(result.is_ok());
        // Verify balance_last_known includes claimed amount
        assert!(reward_info.balance_last_known >= 1_500000000000000000);
    }

    #[test]
    fn test_accrue_rewards_full_distribution() {
        let mut reward_info = RewardInfo {
            payout_last_paid: 1000,
            balance_last_known: 1_000000000000000000,
            balance_accounted: 0,
            ..RewardInfo::default()
        };

        let result = reward_info.accrue_rewards(
            1_000000000000000000, // 1.0 * D18 (100% reward ratio)
            1_000000000,
            1_000000000,
            9,
            2000,
        );

        assert!(result.is_ok());
        // Should distribute all unaccounted balance
        assert_eq!(
            reward_info.balance_accounted,
            reward_info.balance_last_known
        );
    }

    #[test]
    fn test_accrue_rewards_time_overflow() {
        let mut reward_info = RewardInfo {
            payout_last_paid: 2000, // Future time
            balance_last_known: 1_000000000000000000,
            ..RewardInfo::default()
        };

        let result = reward_info.accrue_rewards(
            500000000000000000,
            1_000000000,
            1_000000000,
            9,
            1000, // Past time
        );

        assert!(result.is_ok());
        // Should not update anything due to overflow
        assert_eq!(reward_info.payout_last_paid, 2000);
        assert_eq!(reward_info.balance_accounted, 0);
        assert_eq!(reward_info.reward_index, 0);
    }

    #[test]
    fn test_accrue_rewards_multiple_updates() {
        let mut reward_info = RewardInfo {
            payout_last_paid: 1000,
            balance_last_known: 1_000000000000000000,
            balance_accounted: 0,
            reward_index: 0,
            ..RewardInfo::default()
        };

        // First update
        reward_info
            .accrue_rewards(500000000000000000, 1_000000000, 1_000000000, 9, 2000)
            .unwrap();

        let first_balance_accounted = reward_info.balance_accounted;
        let first_reward_index = reward_info.reward_index;

        // Simulate rewards accumulating between updates by updating balance_last_known
        reward_info.balance_last_known = 2_000000000000000000;

        // Second update
        reward_info
            .accrue_rewards(500000000000000000, 2_000000000, 1_000000000, 9, 3000)
            .unwrap();

        assert!(reward_info.balance_accounted > first_balance_accounted);
        assert!(reward_info.reward_index > first_reward_index);
    }

    #[test]
    fn test_calculate_delta_index_basic() {
        let mut reward_info = RewardInfo {
            reward_index: 0,
            ..RewardInfo::default()
        };

        let tokens_to_handout = Decimal::ONE_E18;
        let result = reward_info.calculate_delta_index(
            &tokens_to_handout,
            1_000000000, // 1 token in D9
            9,           // Standard SPL token decimals
        );

        assert!(result.is_ok());
        // Expected: (D18 * D18 * D9) / (D9 * D18) = D18
        assert_eq!(reward_info.reward_index, 1_000000000000000000);
    }

    #[test]
    fn test_calculate_delta_index_fractional() {
        let mut reward_info = RewardInfo::default();

        let tokens_to_handout = Decimal::from_scaled(500000000000000000u128); // 0.5 * D18
        let result = reward_info.calculate_delta_index(
            &tokens_to_handout,
            2_000000000, // 2 tokens in D9
            9,
        );

        assert!(result.is_ok());
        // Expected: (0.5 * D18 * D18 * D9) / (2 * D9 * D18) = 0.25 * D18 (rounded up)
        assert_eq!(reward_info.reward_index, 250000000000000001);
    }

    #[test]
    fn test_calculate_delta_index_large_numbers() {
        let mut reward_info = RewardInfo::default();

        let tokens_to_handout = Decimal::from_scaled(1_000000000000000000000u128); // 1000 * D18
        let result = reward_info.calculate_delta_index(
            &tokens_to_handout,
            1_000000000, // 1 token in D9
            9,
        );

        assert!(result.is_ok());
        // Expected: (1000 * D18 * D18 * D9) / (D9 * D18) = 1000 * D18
        assert_eq!(reward_info.reward_index, 1000_000000000000000000);
    }

    #[test]
    fn test_calculate_delta_index_rounding() {
        let mut reward_info = RewardInfo::default();

        let tokens_to_handout = Decimal::from_scaled(333333333333333333u128); // ~0.333... * D18
        let result = reward_info.calculate_delta_index(
            &tokens_to_handout,
            3_000000000, // 3 tokens in D9
            9,
        );

        assert!(result.is_ok());
        // Expected: (~0.333 * D18 * D18 * D9) / (3 * D9 * D18) ≈ 0.111... * D18
        assert_eq!(reward_info.reward_index, 111111111111111112); // Rounds up due to Ceiling
    }

    #[test]
    fn test_calculate_delta_index_zero_handout() {
        let mut reward_info = RewardInfo {
            reward_index: 1_000000000000000000,
            ..RewardInfo::default()
        };

        let tokens_to_handout = Decimal::ZERO;
        let result = reward_info.calculate_delta_index(&tokens_to_handout, 1_000000000, 9);

        assert!(result.is_ok());
        assert_eq!(reward_info.reward_index, 1_000000000000000000);
    }

    #[test]
    fn test_calculate_delta_index_zero_supply() {
        let mut reward_info = RewardInfo::default();
        let tokens_to_handout = Decimal::ONE_E18;

        let result = reward_info.calculate_delta_index(&tokens_to_handout, 0, 9);
        assert!(result.is_err());
    }
}
