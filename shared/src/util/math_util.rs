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
        const PRECISION: u128 = 1_000_000_000; // D9

        // If no time has elapsed, return 1.0 (in D9)
        if elapsed == 0 {
            return PRECISION as u64;
        }

        let one = PRECISION;
        let fee = fee_per_second as u128;

        // Calculate (1 - fee_per_second) in D9
        let base = one.checked_sub(fee).unwrap();

        // Use binary exponentiation for efficient power calculation
        let mut result = one;
        let mut current_base = base;
        let mut exp = elapsed;

        while exp > 0 {
            if exp & 1 == 1 {
                // result = (result * current_base) / PRECISION to maintain D9
                result = result.checked_mul(current_base).unwrap() / PRECISION;
            }
            // current_base = (current_base * current_base) / PRECISION to maintain D9
            current_base = current_base.checked_mul(current_base).unwrap() / PRECISION;
            exp >>= 1;
        }

        // Convert back to u64 with proper rounding
        match rounding {
            RoundingMode::Floor => result as u64,
            RoundingMode::Ceil => {
                if result % PRECISION > 0 {
                    (result / PRECISION + 1) as u64
                } else {
                    result as u64
                }
            }
        }
    }
}
