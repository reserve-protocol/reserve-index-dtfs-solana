use crate::constants::D18;
use crate::errors::ErrorCode::MathOverflow;
use anchor_lang::prelude::*;
use bytemuck::{Pod, Zeroable};
use spl_math::uint::U256;

#[derive(Debug, Clone)]
pub struct CustomPreciseNumber(pub U256);

impl CustomPreciseNumber {
    pub fn ten() -> Self {
        CustomPreciseNumber(U256::from(10).checked_mul(D18).unwrap())
    }

    pub fn one() -> Self {
        CustomPreciseNumber(U256::from(1))
    }

    pub fn one_e18() -> Self {
        CustomPreciseNumber(D18)
    }

    pub fn from_u64(value: u64) -> Result<Self> {
        let result = U256::from(value).checked_mul(D18).ok_or(MathOverflow)?;

        Ok(CustomPreciseNumber(result))
    }

    pub fn from_u128(value: u128) -> Result<Self> {
        let result = U256::from(value).checked_mul(D18).ok_or(MathOverflow)?;

        Ok(CustomPreciseNumber(result))
    }

    pub fn as_u256(&self) -> U256 {
        self.0
    }

    pub fn as_u256_number(&self) -> U256Number {
        U256Number::from_u256(self.0)
    }
}

impl From<u64> for CustomPreciseNumber {
    fn from(value: u64) -> Self {
        CustomPreciseNumber::from_u64(value).unwrap()
    }
}

impl From<u128> for CustomPreciseNumber {
    fn from(value: u128) -> Self {
        CustomPreciseNumber::from_u128(value).unwrap()
    }
}

impl From<U256> for CustomPreciseNumber {
    fn from(value: U256) -> Self {
        CustomPreciseNumber(value)
    }
}

impl CustomPreciseNumber {
    pub fn add(&self, other: &Self) -> Result<Self> {
        let result = self.0.checked_add(other.0).ok_or(MathOverflow)?;

        Ok(CustomPreciseNumber(result))
    }

    pub fn sub(&self, other: &Self) -> Result<Self> {
        let result = self.0.checked_sub(other.0).ok_or(MathOverflow)?;

        Ok(CustomPreciseNumber(result))
    }

    pub fn mul(&self, other: &Self) -> Result<Self> {
        let result = self
            .0
            .checked_mul(other.0)
            .ok_or(MathOverflow)?
            .checked_div(D18)
            .ok_or(MathOverflow)?;

        Ok(CustomPreciseNumber(result))
    }

    pub fn div(&self, other: &Self) -> Result<Self> {
        let result = self
            .0
            .checked_mul(D18)
            .ok_or(MathOverflow)?
            .checked_div(other.0)
            .ok_or(MathOverflow)?;

        Ok(CustomPreciseNumber(result))
    }

    pub fn pow(&self, exponent: u64) -> Result<Self> {
        if exponent == 0 {
            return Ok(CustomPreciseNumber::one_e18());
        }
        if exponent == 1 {
            return Ok(self.clone());
        }

        let mut base = self.clone();
        let mut result = CustomPreciseNumber::one_e18();
        let mut exp = exponent;

        while exp > 0 {
            if exp & 1 == 1 {
                result = result.mul(&base)?;
            }
            if exp > 1 {
                base = base.mul(&base)?;
            }
            exp >>= 1;
        }

        Ok(result)
    }

    pub fn to_u64_floor(&self) -> Result<u64> {
        let result = self.0.checked_div(D18).ok_or(MathOverflow)?.as_u64();

        Ok(result)
    }

    pub fn to_u64_ceil(&self) -> Result<u64> {
        let result = self
            .0
            .checked_add(D18.checked_sub(U256::from(1)).ok_or(MathOverflow)?)
            .ok_or(MathOverflow)?
            .checked_div(D18)
            .ok_or(MathOverflow)?
            .as_u64();

        Ok(result)
    }

    pub fn to_u128_floor(&self) -> Result<u128> {
        let result = self.0.checked_div(D18).ok_or(MathOverflow)?.as_u128();

        Ok(result)
    }

    pub fn to_u128_ceil(&self) -> Result<u128> {
        let result = self
            .0
            .checked_add(D18.checked_sub(U256::from(1)).ok_or(MathOverflow)?)
            .ok_or(MathOverflow)?
            .checked_div(D18)
            .ok_or(MathOverflow)?
            .as_u128();

        Ok(result)
    }
}

impl CustomPreciseNumber {
    pub fn add_generic<T: Into<CustomPreciseNumber>>(&self, other: T) -> Result<Self> {
        let other = other.into();
        self.add(&other)
    }

    pub fn sub_generic<T: Into<CustomPreciseNumber>>(&self, other: T) -> Result<Self> {
        let other = other.into();
        self.sub(&other)
    }

    pub fn mul_generic<T: Into<CustomPreciseNumber>>(&self, other: T) -> Result<Self> {
        let other = other.into();
        self.mul(&other)
    }

    pub fn div_generic<T: Into<CustomPreciseNumber>>(&self, other: T) -> Result<Self> {
        let other = other.into();
        self.div(&other)
    }
}

impl CustomPreciseNumber {
    const MAX_ITERATIONS: usize = 100;
    const EPSILON: U256 = U256([1, 0, 0, 0]);

    pub fn ln(&self) -> Result<Option<Self>> {
        let one = CustomPreciseNumber::one_e18();
        let zero = CustomPreciseNumber(U256::from(0));

        if self.0 == one.0 {
            return Ok(Some(zero));
        }

        if self.0 < D18 {
            return Ok(None);
        }

        // Find the power of e that gets us in range [1, e)
        let mut power = 0i32;
        let e = CustomPreciseNumber(
            U256::from(2718281828459045235u64)
                .checked_mul(D18)
                .ok_or(MathOverflow)?,
        );
        let mut normalized = self.clone();

        while normalized.0 > e.0 {
            normalized = normalized.div(&e)?;
            power += 1;
        }

        while normalized.0 < one.0 {
            normalized = normalized.mul(&e)?;
            power -= 1;
        }

        // Compute z = (x - 1) / (x + 1)
        let numerator = normalized.sub(&one)?;
        let denominator = normalized.add(&one)?;
        let z = numerator.div(&denominator)?;

        // z^2
        let z_squared = z.mul(&z)?;

        // Taylor series loop
        let mut term = z.clone();
        let mut result = CustomPreciseNumber(U256::from(0));
        let mut n = 1u64;

        while n <= Self::MAX_ITERATIONS as u64 {
            let fraction =
                CustomPreciseNumber::one_e18().div(&CustomPreciseNumber::from_u64(2 * n - 1)?)?;

            result = result.add(&term.mul(&fraction)?)?;
            term = term.mul(&z_squared)?;

            if term.0 < Self::EPSILON {
                break;
            }

            n += 1;
        }

        // Multiply by 2 and add the power of e component
        let mut final_result = result.mul(&CustomPreciseNumber::from_u64(2)?)?;
        if power != 0 {
            let e_component = CustomPreciseNumber::from_u64(power.unsigned_abs() as u64)?;
            if power > 0 {
                final_result = final_result.add(&e_component)?;
            } else {
                final_result = final_result.sub(&e_component)?;
            }
        }

        Ok(Some(final_result))
    }

    pub fn exp(&self, negate_result: bool) -> Result<Option<Self>> {
        if self.0 == U256::from(0) {
            return Ok(Some(CustomPreciseNumber::one_e18()));
        }

        let mut term = CustomPreciseNumber::one_e18();
        let mut result = term.clone();
        let mut n = 1u64;

        while n <= Self::MAX_ITERATIONS as u64 {
            term = term.mul(self)?.div_generic(n)?;
            result = result.add(&term)?;

            if term.0 < Self::EPSILON {
                break;
            }

            n += 1;
        }

        if negate_result {
            Ok(Some(CustomPreciseNumber::one_e18().div(&result)?))
        } else {
            Ok(Some(result))
        }
    }
}

#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Debug, Default, InitSpace, Zeroable, Pod, Copy,
)]
#[repr(C)]
pub struct U256Number {
    pub value: [u64; 4],
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

    pub fn to_custom_precise_number(&self) -> CustomPreciseNumber {
        CustomPreciseNumber::from(self.to_u256())
    }
}
