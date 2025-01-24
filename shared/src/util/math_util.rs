use crate::constants::D18;
use crate::errors::ErrorCode;
use anchor_lang::prelude::*;
use spl_math::{precise_number::PreciseNumber, uint::U256};

pub enum RoundingMode {
    Floor,
    Ceil,
}

#[derive(Debug, Clone)]
pub struct CustomPreciseNumber(PreciseNumber);

impl CustomPreciseNumber {
    pub fn one_e18() -> Self {
        CustomPreciseNumber::from_u128(1_000_000_000_000_000_000)
    }

    pub fn from_u64(value: u64) -> Self {
        CustomPreciseNumber(
            PreciseNumber::new(value as u128).expect(&ErrorCode::MathOverflow.name()),
        )
    }

    pub fn from_u128(value: u128) -> Self {
        CustomPreciseNumber(PreciseNumber::new(value).expect(&ErrorCode::MathOverflow.name()))
    }

    pub fn as_inner(&self) -> &PreciseNumber {
        &self.0
    }

    pub fn into_inner(self) -> PreciseNumber {
        self.0
    }
}

impl From<u64> for CustomPreciseNumber {
    fn from(value: u64) -> Self {
        CustomPreciseNumber::from_u64(value)
    }
}

impl From<u128> for CustomPreciseNumber {
    fn from(value: u128) -> Self {
        CustomPreciseNumber::from_u128(value)
    }
}

impl From<U256> for CustomPreciseNumber {
    fn from(value: U256) -> Self {
        CustomPreciseNumber(PreciseNumber { value })
    }
}

impl CustomPreciseNumber {
    pub fn add(&self, other: &Self) -> Self {
        CustomPreciseNumber(self.0.checked_add(&other.0).expect(&ErrorCode::MathOverflow.name()))
    }

    pub fn sub(&self, other: &Self) -> Self {
        CustomPreciseNumber(self.0.checked_sub(&other.0).expect(&ErrorCode::MathOverflow.name()))
    }

    pub fn mul(&self, other: &Self) -> Self {
        CustomPreciseNumber(self.0.checked_mul(&other.0).expect(&ErrorCode::MathOverflow.name()))
    }

    pub fn div(&self, other: &Self) -> Self {
        CustomPreciseNumber(self.0.checked_div(&other.0).expect(&ErrorCode::MathOverflow.name()))
    }

    pub fn pow(&self, other: u64) -> Self {
        let mut base = self.clone();
        let mut result = CustomPreciseNumber::from_u128(D18);
        let mut exponent = other;

        while exponent > 0 {
            if exponent % 2 == 1 {
                result = result.mul(&base).div_generic(D18);
            }
            base = base.mul(&base).div_generic(D18);
            exponent /= 2;
        }

        result
    }

    pub fn mul_10_pow_generic(&self, other: u64) -> Self {
        self.mul(&CustomPreciseNumber::from_u128(10_u128).pow(other))
    }

    pub fn div_10_pow_generic(&self, other: u64) -> Self {
        self.div(&CustomPreciseNumber::from_u128(10_u128).pow(other))
    }

    pub fn to_u64_floor(&self) -> u64 {
        self.0.floor().expect(&ErrorCode::MathOverflow.name()).to_imprecise().expect(&ErrorCode::MathOverflow.name()) as u64
    }

    pub fn to_u64_ceil(&self) -> u64 {
        self.0.ceiling().expect(&ErrorCode::MathOverflow.name()).to_imprecise().expect(&ErrorCode::MathOverflow.name()) as u64
    }

    pub fn to_u128_floor(&self) -> u128 {
        self.0.floor().expect(&ErrorCode::MathOverflow.name()).to_imprecise().expect(&ErrorCode::MathOverflow.name())
    }

    pub fn to_u128_ceil(&self) -> u128 {
        self.0.ceiling().expect(&ErrorCode::MathOverflow.name()).to_imprecise().expect(&ErrorCode::MathOverflow.name())
    }
}

impl CustomPreciseNumber {
    pub fn add_generic<T: Into<CustomPreciseNumber>>(&self, other: T) -> Self {
        let other = other.into();
        self.add(&other)
    }

    pub fn sub_generic<T: Into<CustomPreciseNumber>>(&self, other: T) -> Self {
        let other = other.into();
        self.sub(&other)
    }

    pub fn mul_generic<T: Into<CustomPreciseNumber>>(&self, other: T) -> Self {
        let other = other.into();
        self.mul(&other)
    }

    pub fn div_generic<T: Into<CustomPreciseNumber>>(&self, other: T) -> Self {
        let other = other.into();
        self.div(&other)
    }

    pub fn mul_div_generic<T: Into<CustomPreciseNumber>>(&self, other: T, divisor: T) -> Self {
        let other = other.into();
        let divisor = divisor.into();
        self.mul(&other).div(&divisor)
    }
}

impl CustomPreciseNumber {
    const MAX_ITERATIONS: usize = 100;
    const EPSILON: u128 = 1;

    pub fn ln(&self) -> Option<Self> {
        let one = CustomPreciseNumber::from_u128(D18);

        if self.0.less_than(&CustomPreciseNumber::from_u128(1).0) {
            return None;
        }

        // Find the power of e that gets us in range [1, e)
        let mut power = 0i32;
        let e = CustomPreciseNumber::from_u128(2718281828459045235); // e * 1e18
        let mut normalized = self.clone();

        while normalized.0.greater_than(&e.0) {
            normalized = normalized.div(&e);
            power += 1;
        }

        while normalized.0.less_than(&one.0) {
            normalized = normalized.mul(&e);
            power -= 1;
        }

        // Now normalized is in [1, e)
        let one = CustomPreciseNumber::from_u128(D18);

        // Compute z = (x - 1) / (x + 1)
        let numerator = normalized.sub(&one);
        let denominator = normalized.add(&one);
        let z = numerator.div(&denominator);

        // z^2
        let z_squared = z.mul(&z);

        // Taylor series loop
        let mut term = z.clone();
        let mut result = CustomPreciseNumber::from_u128(0);
        let mut n = 1;

        while n <= Self::MAX_ITERATIONS {
            let fraction = CustomPreciseNumber::from_u128(D18)
                .div(&CustomPreciseNumber::from_u128((2 * n - 1) as u128 * D18));

            result = result.add(&term.mul(&fraction));
            term = term.mul(&z_squared);

            if let Some(term_value) = term.0.to_imprecise() {
                if term_value < Self::EPSILON {
                    break;
                }
            } else {
                return None;
            }

            n += 1;
        }

        // Multiply by 2 and add the power of e component
        let mut final_result = result.mul(&CustomPreciseNumber::from_u128(2 * D18));
        if power != 0 {
            let e_component = CustomPreciseNumber::from_u128((power as u128) * D18);
            final_result = final_result.add(&e_component);
        }

        Some(final_result)
    }

    /// Compute exp(x) using Taylor series with `PreciseNumber`.
    /// Supports negative inputs by expanding \( e^x = \sum_{n=0}^{\infty} \frac{x^n}{n!} \).
    pub fn exp(&self, negate_result: bool) -> Option<CustomPreciseNumber> {
        let mut term = CustomPreciseNumber::from_u128(D18);
        let mut result = term.clone();
        let mut n = 1;

        while n <= Self::MAX_ITERATIONS {
            term = term.mul(&self).div_generic((n as u128) * D18);
            result = result.add(&term);

            if let Some(term_value) = term.0.to_imprecise() {
                if term_value < Self::EPSILON {
                    break;
                }
            } else {
                return None;
            }

            n += 1;
        }

        if negate_result {
            Some(CustomPreciseNumber::from_u128(D18).div(&result))
        } else {
            Some(result)
        }
    }
}

/*
Serializable U256
*/
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Default, InitSpace)]
pub struct U256Number {
    pub value: [u64; 4], // U256 is represented as 4 u64 values
}

impl U256Number {
    pub const ZERO: Self = U256Number { value: [0; 4] };

    pub fn from_u256(num: U256) -> Self {
        let words = num.0;
        U256Number { value: words }
    }

    pub fn to_u256(&self) -> U256 {
        U256(self.value)
    }
}
