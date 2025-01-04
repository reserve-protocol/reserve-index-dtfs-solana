pub trait SafeArithmetic {
    fn to_u128_calc<F, T>(self, calc: F) -> T
    where
        F: FnOnce(u128) -> u128,
        T: TryFrom<u128>,
        <T as TryFrom<u128>>::Error: std::fmt::Debug;

    fn mul_div_precision(self, numerator: u64, denominator: u64) -> u64;
}

impl SafeArithmetic for u64 {
    fn to_u128_calc<F, T>(self, calc: F) -> T
    where
        F: FnOnce(u128) -> u128,
        T: TryFrom<u128>,
        <T as TryFrom<u128>>::Error: std::fmt::Debug,
    {
        let result = calc(self as u128);
        T::try_from(result).unwrap()
    }

    fn mul_div_precision(self, numerator: u64, denominator: u64) -> u64 {
        self.to_u128_calc(|amount| {
            amount
                .checked_mul(numerator as u128)
                .unwrap()
                .checked_div(denominator as u128)
                .unwrap()
        })
    }
}
