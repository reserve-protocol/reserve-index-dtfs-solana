#[cfg(test)]
mod tests {

    use shared::constants::D18;
    use shared::util::math_util::CustomPreciseNumber;
    use spl_math::uint::U256;
    mod basic_operations {

        use super::*;

        #[test]
        fn test_one_e18() {
            let one = CustomPreciseNumber::one_e18();
            assert_eq!(one.0, D18);
        }

        #[test]
        fn test_from_conversions() {
            let num_u64 = CustomPreciseNumber::from_u64(100).unwrap();
            assert_eq!(num_u64.to_u64_floor().unwrap(), 100);

            let num_u128 = CustomPreciseNumber::from_u128(100).unwrap();
            assert_eq!(num_u128.to_u128_floor().unwrap(), 100);

            let value = U256::from(100u64) * D18;
            let num_u256 = CustomPreciseNumber::from(value);
            assert_eq!(num_u256.to_u64_floor().unwrap(), 100);
        }

        #[test]
        fn test_basic_arithmetic() {
            let a = CustomPreciseNumber::from_u64(100).unwrap();
            let b = CustomPreciseNumber::from_u64(50).unwrap();

            assert_eq!(a.add(&b).unwrap().to_u64_floor().unwrap(), 150);
            assert_eq!(a.sub(&b).unwrap().to_u64_floor().unwrap(), 50);
            assert_eq!(a.mul(&b).unwrap().to_u64_floor().unwrap(), 5000);
            assert_eq!(a.div(&b).unwrap().to_u64_floor().unwrap(), 2);
        }

        #[test]
        fn test_generic_arithmetic() {
            let a = CustomPreciseNumber::from_u64(100).unwrap();

            assert_eq!(a.add_generic(50u64).unwrap().to_u64_floor().unwrap(), 150);
            assert_eq!(a.sub_generic(50u64).unwrap().to_u64_floor().unwrap(), 50);
            assert_eq!(a.mul_generic(50u64).unwrap().to_u64_floor().unwrap(), 5000);
            assert_eq!(a.div_generic(50u64).unwrap().to_u64_floor().unwrap(), 2);
        }

        #[test]
        #[should_panic]
        fn test_div_by_zero() {
            let a = CustomPreciseNumber::from_u64(100).unwrap();
            let b = CustomPreciseNumber(U256::zero());
            a.div(&b).unwrap();
        }
    }

    mod pow_operations {

        use super::*;

        #[test]
        fn test_pow() {
            let base = CustomPreciseNumber::from_u64(2).unwrap();
            assert_eq!(base.pow(3).unwrap().to_u64_floor().unwrap(), 8);

            let base = CustomPreciseNumber(D18);
            assert_eq!(base.pow(1).unwrap().0, D18);
        }

        #[test]
        fn test_pow_zero_exponent() {
            let base = CustomPreciseNumber::from_u64(2).unwrap();
            assert_eq!(base.pow(0).unwrap().0, D18);
        }
    }

    mod rounding_operations {
        use super::*;

        #[test]
        fn test_floor_ceil_u64() {
            let value = U256::from(100) * D18 + U256::from(500_000_000_000_000_000u64);
            let num = CustomPreciseNumber(value);
            assert_eq!(num.to_u64_floor().unwrap(), 100);
            assert_eq!(num.to_u64_ceil().unwrap(), 101);
        }

        #[test]
        fn test_floor_ceil_u128() {
            let value = U256::from(100u128) * D18 + U256::from(500_000_000_000_000_000u128);
            let num = CustomPreciseNumber(value);
            assert_eq!(num.to_u128_floor().unwrap(), 100);
            assert_eq!(num.to_u128_ceil().unwrap(), 101);
        }
    }

    mod logarithm_operations {
        use super::*;

        #[test]
        fn test_ln_basic() {
            let one = CustomPreciseNumber::one_e18();
            assert_eq!(one.ln().unwrap().unwrap().to_u64_floor().unwrap(), 0);

            let e = CustomPreciseNumber(U256::from(2718281828459045235u64));

            let ln_e = e.ln().unwrap().unwrap();

            // ln(e) should be very close to 1 * D18
            let tolerance = U256::from(1_000_000_000_000_000u64);
            assert!(ln_e.0 > D18 - tolerance);
            assert!(ln_e.0 < D18 + tolerance);
        }

        #[test]
        fn test_ln_values() {
            let two = CustomPreciseNumber(U256::from(2) * D18);
            let ln_2 = two.ln().unwrap().unwrap();
            let expected = U256::from(693147180559945309u64); // ln(2) * 1e18
            assert!(ln_2.0 > expected - U256::from(1_000_000u64));
            assert!(ln_2.0 < expected + U256::from(1_000_000u64));
        }

        #[test]
        fn test_ln_invalid_input() {
            let zero = CustomPreciseNumber(U256::zero());
            assert!(zero.ln().unwrap().is_none());

            let less_than_one = CustomPreciseNumber(D18 / U256::from(2));
            assert!(less_than_one.ln().unwrap().is_none());
        }
    }

    mod exponential_operations {
        use spl_math::uint::U256;

        use super::*;

        #[test]
        fn test_exp_basic() {
            // Test exp(0) = 1
            let zero = CustomPreciseNumber(U256::zero());
            assert_eq!(zero.exp(false).unwrap().unwrap().0, D18); // exp(0) = 1

            // Test exp(1) = e
            let one = CustomPreciseNumber(D18);
            let e = one.exp(false).unwrap().unwrap();

            let expected = U256::from(2718281828459045235u64);
            let tolerance = U256::from(10000000000000u64);

            assert!(e.0 > expected - tolerance);
            assert!(e.0 < expected + tolerance);
        }

        #[test]
        fn test_exp_negative() {
            let one = CustomPreciseNumber(D18);
            let exp_neg = one.exp(true).unwrap().unwrap();
            assert!(exp_neg.0 < D18);
        }
    }

    mod overflow_tests {
        use super::*;

        #[test]
        #[should_panic]
        fn test_add_overflow() {
            let max = CustomPreciseNumber(U256::MAX);
            let one = CustomPreciseNumber::from_u64(1).unwrap();
            max.add(&one).unwrap();
        }

        #[test]
        #[should_panic]
        fn test_mul_overflow() {
            let max = CustomPreciseNumber(U256::MAX);
            max.mul(&max).unwrap();
        }

        #[test]
        #[should_panic]
        fn test_pow_overflow() {
            let large = CustomPreciseNumber(U256::MAX);
            large.pow(10).unwrap();
        }
    }
}
