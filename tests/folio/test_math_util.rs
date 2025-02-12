#[cfg(test)]
mod tests {
    use folio::utils::{Decimal, IntoU256, Rounding};
    use shared::constants::{D18_U256, D9_U256};
    use spl_math::uint::U256;

    #[test]
    fn test_decimal_from_plain() {
        let result = Decimal::from_plain(1).unwrap();
        assert_eq!(result.0, D18_U256);

        let result = Decimal::from_plain(0).unwrap();
        assert_eq!(result.0, U256::from(0));

        let result = Decimal::from_plain(1000).unwrap();
        assert_eq!(result.0, U256::from(1000) * D18_U256);
    }

    #[test]
    fn test_decimal_from_token_amount() {
        let result = Decimal::from_token_amount(1u64).unwrap();
        assert_eq!(result.0, D9_U256);

        let result = Decimal::from_token_amount(0u64).unwrap();
        assert_eq!(result.0, U256::from(0));

        let result = Decimal::from_token_amount(1000u64).unwrap();
        assert_eq!(result.0, U256::from(1000) * D9_U256);
    }

    #[test]
    fn test_decimal_to_token_amount() {
        let decimal = Decimal::from_token_amount(100u64).unwrap();
        let result = decimal.to_token_amount(Rounding::Floor).unwrap();
        assert_eq!(result.0, 100);

        let decimal = Decimal::from_token_amount(100u64).unwrap();
        let result = decimal.to_token_amount(Rounding::Ceiling).unwrap();
        assert_eq!(result.0, 100);

        let decimal = Decimal(U256::from(100) * D9_U256 + U256::from(1));
        let floor_result = decimal.to_token_amount(Rounding::Floor).unwrap();
        let ceiling_result = decimal.to_token_amount(Rounding::Ceiling).unwrap();
        assert_eq!(floor_result.0, 100);
        assert_eq!(ceiling_result.0, 101);
    }

    #[test]
    fn test_decimal_arithmetic() {
        let a = Decimal::from_plain(100).unwrap();
        let b = Decimal::from_plain(50).unwrap();

        let sum = a.add(&b).unwrap();
        assert_eq!(sum.0, Decimal::from_plain(150).unwrap().0);

        let diff = a.sub(&b).unwrap();
        assert_eq!(diff.0, Decimal::from_plain(50).unwrap().0);

        // Don't scale back the mul, since it's done outside of that instruction
        let product = a.mul(&b).unwrap();
        assert_eq!(
            product.0,
            Decimal::from_plain(5000)
                .unwrap()
                .0
                .checked_mul(D18_U256)
                .unwrap()
        );

        // Don't scale back the div, since it's done outside of that instruction
        let quotient = a.div(&b).unwrap();
        assert_eq!(quotient.0, Decimal::from_scaled(2u128).0);
    }

    #[test]
    fn test_decimal_pow() {
        let base = Decimal::from_plain(2).unwrap();

        let result = base.pow(0).unwrap();
        assert_eq!(result, Decimal::ONE_E18);

        let result = base.pow(1).unwrap();
        assert_eq!(result, base);

        let result = base.pow(2).unwrap();
        assert_eq!(result.0, Decimal::from_plain(4).unwrap().0);

        let result = base.pow(3).unwrap();
        assert_eq!(result.0, Decimal::from_plain(8).unwrap().0);
    }

    #[test]
    fn test_decimal_ln() {
        let one = Decimal::ONE_E18;
        assert_eq!(one.ln().unwrap().unwrap(), Decimal::ZERO);

        let e = Decimal::from_scaled(Decimal::E);
        let ln_e = e.ln().unwrap().unwrap();
        assert!(ln_e.0 > Decimal::ONE_E18.0 - U256::from(1000));
        assert!(ln_e.0 < Decimal::ONE_E18.0 + U256::from(1000));

        let less_than_one = Decimal::from_plain(0).unwrap();
        assert_eq!(less_than_one.ln().unwrap(), None);

        // Test ln(1000)
        let thousand = Decimal::from_plain(1000).unwrap();
        let ln_thousand = thousand.ln().unwrap().unwrap();

        let expected = U256::from(6_907_755_278_982_137_052u128);
        assert!(ln_thousand.0 > expected - U256::from(1000));
        assert!(ln_thousand.0 < expected + U256::from(1000));
    }

    #[test]
    fn test_decimal_exp() {
        let zero = Decimal::ZERO;
        assert_eq!(zero.exp(false).unwrap().unwrap(), Decimal::ONE_E18);

        let one = Decimal::ONE_E18;
        let e = one.exp(false).unwrap().unwrap();

        assert!(e.0 > Decimal::from_scaled(Decimal::E).0 - U256::from(1000));
        assert!(e.0 < Decimal::from_scaled(Decimal::E).0 + U256::from(1000));

        let neg_one = one.exp(true).unwrap().unwrap();
        let expected = D18_U256
            .checked_mul(U256::from(36787944117144232u128))
            .unwrap()
            .checked_div(U256::from(100_000_000_000_000_000u128))
            .unwrap();

        assert!(neg_one.0 > expected.checked_sub(U256::from(1000)).unwrap());
        assert!(neg_one.0 < expected.checked_add(U256::from(1000)).unwrap());
    }

    #[test]
    fn test_decimal_comparison() {
        let a = Decimal::from_plain(100).unwrap();
        let b = Decimal::from_plain(50).unwrap();
        let c = Decimal::from_plain(100).unwrap();

        assert!(a > b);
        assert!(b < a);
        assert!(a >= c);
        assert!(a <= c);
        assert_eq!(a, c);
        assert!(a != b);
    }

    #[test]
    fn test_into_u256() {
        let a: u64 = 100;
        let b: u128 = 100;
        let c = U256::from(100);

        assert_eq!(a.into_u256(), U256::from(100));
        assert_eq!(b.into_u256(), U256::from(100));
        assert_eq!(c.into_u256(), U256::from(100));
    }

    #[test]
    fn test_decimal_to_scaled() {
        let decimal = Decimal::from_scaled(D18_U256 + U256::from(1))
            .div(&Decimal::from_scaled(100u128))
            .unwrap();
        let floor_result = decimal.to_scaled(Rounding::Floor).unwrap();
        let ceiling_result = decimal.to_scaled(Rounding::Ceiling).unwrap();

        assert_eq!(floor_result, decimal.0.as_u128());
        assert_eq!(ceiling_result, decimal.0.as_u128() + 1);
    }
}
