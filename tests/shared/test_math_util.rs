#[cfg(test)]
mod tests {
    use shared::{
        constants::SCALAR,
        util::math_util::{RoundingMode, SafeArithmetic},
    };

    #[test]
    fn test_mul_precision() {
        let base: u64 = 1_000_000_000; // 1.0 in D9
        let multiplier: u64 = 500_000_000; // 0.5 in D9

        let result = base.mul_precision(multiplier);
        assert_eq!(result, 500_000_000_000_000_000);
    }

    #[test]
    fn test_mul_precision_to_u128() {
        let base: u64 = 1_000_000_000; // 1.0 in D9
        let multiplier: u64 = 500_000_000; // 0.5 in D9

        let result = base.mul_precision_to_u128(multiplier);
        assert_eq!(result, 500_000_000_000_000_000);
    }

    #[test]
    fn test_mul_div_precision() {
        let base: u64 = 1_000_000_000; // 1.0 in D9
        let numerator: u64 = 500_000_000; // 0.5 in D9
        let denominator: u64 = 1_000_000_000; // 1.0 in D9

        let result = base.mul_div_precision(numerator, denominator, RoundingMode::Floor);
        assert_eq!(result, 500_000_000); // Should be 0.5 in D9

        let result = base.mul_div_precision(numerator, denominator, RoundingMode::Ceil);
        assert_eq!(result, 500_000_000); // Should still be 0.5 in D9 (no remainder)

        let base: u64 = 1_000_000_001; // Slightly over 1.0
        let result_floor = base.mul_div_precision(numerator, denominator, RoundingMode::Floor);
        let result_ceil = base.mul_div_precision(numerator, denominator, RoundingMode::Ceil);
        assert_eq!(result_floor, 500_000_000);
        assert_eq!(result_ceil, 500_000_001);
    }

    #[test]
    fn test_mul_div_precision_from_u128() {
        let amount: u128 = 1_000_000_000; // 1.0 in D9
        let numerator: u128 = 500_000_000; // 0.5 in D9
        let denominator: u128 = 1_000_000_000; // 1.0 in D9

        let result = <u64 as SafeArithmetic>::mul_div_precision_from_u128(
            amount,
            numerator,
            denominator,
            RoundingMode::Floor,
        );
        assert_eq!(result, 500_000_000); // Should be 0.5 in D9
    }

    #[test]
    fn test_compound_interest() {
        // Test no elapsed time
        let result = <u64 as SafeArithmetic>::compound_interest(13284, 0, RoundingMode::Floor);
        assert_eq!(result, SCALAR);

        // Test one year
        let result = <u64 as SafeArithmetic>::compound_interest(
            13284, // ~50% APY in D9
            30,    // 30 seconds
            RoundingMode::Floor,
        );

        assert!(result > 999_000_000 && result < 1_000_000_000);

        // Test small time period
        let result = <u64 as SafeArithmetic>::compound_interest(13284, 1, RoundingMode::Floor);
        // Should be slightly less than 1.0
        assert!(result < 1_000_000_000 && result > 999_900_000);
    }

    #[test]
    fn test_rounding_modes() {
        let base: u64 = 1_000_000_001; // Slightly over 1.0
        let numerator: u64 = 1;
        let denominator: u64 = 2;

        let floor_result = base.mul_div_precision(numerator, denominator, RoundingMode::Floor);
        let ceil_result = base.mul_div_precision(numerator, denominator, RoundingMode::Ceil);

        assert_eq!(floor_result, 500_000_000);
        assert_eq!(ceil_result, 500_000_001);
    }

    #[test]
    #[should_panic]
    fn test_overflow() {
        let base: u64 = u64::MAX;
        let multiplier: u64 = 2;
        base.mul_precision(multiplier); // Should panic
    }

    #[test]
    fn test_edge_cases() {
        // Test with zero
        assert_eq!(0u64.mul_precision(1_000_000_000), 0);

        // Test with one
        assert_eq!(
            1_000_000_000u64.mul_div_precision(1_000_000_000, 1_000_000_000, RoundingMode::Floor),
            1_000_000_000
        );

        // Test compound interest with max fee
        let result = <u64 as SafeArithmetic>::compound_interest(
            999_999_999, // Maximum possible fee (just under 1.0)
            1,
            RoundingMode::Floor,
        );
        assert!(result < 1_000_000_000); // Should be very close to zero but positive
    }

    #[test]
    fn test_precision_maintenance() {
        let base: u64 = 1_000_000_000; // 1.0 in D9
        let result = base
            .mul_div_precision(500_000_000, 1_000_000_000, RoundingMode::Floor) // 0.5
            .mul_div_precision(250_000_000, 1_000_000_000, RoundingMode::Floor); // 0.125

        assert_eq!(result, 125_000_000); // Should be 0.125 in D9
    }
}
