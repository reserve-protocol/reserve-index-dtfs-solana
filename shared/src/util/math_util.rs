use crate::constants::SCALAR_U128;

#[derive(Copy, Clone)]
pub enum RoundingMode {
    Floor,
    Ceil,
}

pub trait SafeArithmetic {
    fn to_u128_calc<F, T>(self, calc: F) -> T
    where
        F: FnOnce(u128) -> u128,
        T: TryFrom<u128>,
        <T as TryFrom<u128>>::Error: std::fmt::Debug;

    fn mul_precision(self, multiplier: u64) -> u64;
    fn mul_precision_to_u128(self, multiplier: u64) -> u128;
    fn mul_div_precision(self, numerator: u64, denominator: u64, rounding: RoundingMode) -> u64;
    fn mul_div_precision_from_u128(
        amount: u128,
        numerator: u128,
        denominator: u128,
        rounding: RoundingMode,
    ) -> u128;
    fn compound_interest(fee_per_second: u64, elapsed: u64, rounding: RoundingMode) -> u64;
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

    fn mul_precision(self, multiplier: u64) -> u64 {
        self.to_u128_calc(|amount| amount.checked_mul(multiplier as u128).unwrap())
    }

    fn mul_precision_to_u128(self, multiplier: u64) -> u128 {
        (self as u128).checked_mul(multiplier as u128).unwrap()
    }

    fn mul_div_precision(self, numerator: u64, denominator: u64, rounding: RoundingMode) -> u64 {
        self.to_u128_calc(|amount| {
            let result = amount.checked_mul(numerator as u128).unwrap();

            match rounding {
                RoundingMode::Ceil => {
                    // For ceiling, add denominator-1 before dividing
                    let adjusted_result = result.checked_add(denominator as u128 - 1).unwrap();
                    adjusted_result.checked_div(denominator as u128).unwrap()
                }
                RoundingMode::Floor => result.checked_div(denominator as u128).unwrap(),
            }
        })
    }

    fn mul_div_precision_from_u128(
        amount: u128,
        numerator: u128,
        denominator: u128,
        rounding: RoundingMode,
    ) -> u128 {
        let result = amount.checked_mul(numerator).unwrap();

        match rounding {
            RoundingMode::Ceil => {
                // For ceiling, add denominator-1 before dividing
                let adjusted_result = result.checked_add(denominator - 1).unwrap();
                adjusted_result.checked_div(denominator).unwrap()
            }
            RoundingMode::Floor => result.checked_div(denominator).unwrap(),
        }
    }

    fn compound_interest(fee_per_second: u64, elapsed: u64, rounding: RoundingMode) -> u64 {
        if elapsed == 0 {
            return SCALAR_U128 as u64;
        }

        let fee = fee_per_second as u128;
        let base = SCALAR_U128.checked_sub(fee).unwrap();

        let mut result = SCALAR_U128;
        let mut current_base = base;
        let mut exp = elapsed;

        let scalar_u128_half = SCALAR_U128 / 2;

        while exp > 0 {
            if exp & 1 == 1 {
                result = (result * current_base + scalar_u128_half) / SCALAR_U128;
            }
            current_base = (current_base * current_base + scalar_u128_half) / SCALAR_U128;
            exp >>= 1;
        }

        match rounding {
            RoundingMode::Floor => result as u64,
            RoundingMode::Ceil => {
                if result % SCALAR_U128 > 0 {
                    ((result + SCALAR_U128 - 1) / SCALAR_U128 * SCALAR_U128) as u64
                } else {
                    result as u64
                }
            }
        }
    }
}
