use anchor_lang::prelude::*;
use bytemuck::{Pod, Zeroable};
use spl_math::precise_number::PreciseNumber;
use std::{cmp::Ordering, fmt::Display, iter::Sum};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Rounding {
    Floor,
    Ceil,
}

#[derive(
    AnchorSerialize,
    AnchorDeserialize,
    Clone,
    Copy,
    Debug,
    Default,
    PartialEq,
    Eq,
    InitSpace,
    Zeroable,
    Pod,
)]
#[repr(C)]
pub struct DecimalValue {
    pub whole: u64,
    pub fractional: u64,
}

impl Display for DecimalValue {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}.{:018}", self.whole, self.fractional)
    }
}

impl PartialOrd for DecimalValue {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for DecimalValue {
    fn cmp(&self, other: &Self) -> Ordering {
        let self_value = self.to_u128();
        let other_value = other.to_u128();
        self_value.cmp(&other_value)
    }
}

// Keep Sum implementation as is since it's efficient for addition
impl Sum for DecimalValue {
    fn sum<I: Iterator<Item = Self>>(iter: I) -> Self {
        let (whole_sum, fractional_sum) = iter.fold((0u128, 0u128), |(w, f), x| {
            (w + x.whole as u128, f + x.fractional as u128)
        });

        let additional_whole = fractional_sum / Self::MULTIPLIER;
        let final_fractional = fractional_sum % Self::MULTIPLIER;

        Self {
            whole: (whole_sum + additional_whole) as u64,
            fractional: final_fractional as u64,
        }
    }
}

impl From<u64> for DecimalValue {
    fn from(value: u64) -> Self {
        Self::from_u128(value as u128)
    }
}

impl DecimalValue {
    pub const DECIMAL_PLACES: u8 = 18;
    pub const MULTIPLIER: u128 = 1_000_000_000_000_000_000; // 10^18

    pub const SCALAR: DecimalValue = DecimalValue {
        whole: 0,
        fractional: 1,
    };
    pub const ZERO: DecimalValue = DecimalValue {
        whole: 0,
        fractional: 0,
    };
    pub const ONE: DecimalValue = DecimalValue {
        whole: 1,
        fractional: 0,
    };

    // Conversion methods (keep as is since they're already efficient)
    pub fn new(whole: u64, fractional: u64) -> Self {
        let max_fractional = Self::MULTIPLIER as u64 - 1;
        Self {
            whole,
            fractional: fractional.min(max_fractional),
        }
    }

    pub fn from_token_amount(amount: u64, token_decimals: u8) -> Self {
        if token_decimals >= Self::DECIMAL_PLACES {
            return Self::from(amount);
        }

        let scale_up = Self::DECIMAL_PLACES - token_decimals;
        let scaled_amount = (amount as u128)
            .checked_mul(10u128.pow(scale_up as u32))
            .unwrap_or(0);

        Self::from_u128(scaled_amount)
    }

    pub fn from_u64(value: u64) -> Self {
        Self::from_u128(value as u128)
    }

    pub fn from_u128(value: u128) -> Self {
        Self {
            whole: (value / Self::MULTIPLIER) as u64,
            fractional: (value % Self::MULTIPLIER) as u64,
        }
    }

    pub fn to_u128(&self) -> u128 {
        (self.whole as u128 * Self::MULTIPLIER) + self.fractional as u128
    }

    // Conversion to PreciseNumber for calculations
    fn to_precise_number(&self) -> Option<PreciseNumber> {
        PreciseNumber::new(self.to_u128())
    }

    fn from_precise_number(number: &PreciseNumber) -> Option<Self> {
        let value = number.to_imprecise()?;
        Some(Self::from_u128(value))
    }

    pub fn add(&self, other: &Self) -> Option<Self> {
        let a = self.to_precise_number()?;
        let b = other.to_precise_number()?;
        Self::from_precise_number(&a.checked_add(&b)?)
    }

    pub fn sub(&self, other: &Self) -> Option<Self> {
        let a = self.to_precise_number()?;
        let b = other.to_precise_number()?;
        Self::from_precise_number(&a.checked_sub(&b)?)
    }

    pub fn mul(&self, other: &Self) -> Option<Self> {
        let a = self.to_precise_number()?;
        let b = other.to_precise_number()?;
        Self::from_precise_number(&a.checked_mul(&b)?)
    }

    pub fn div(&self, other: &Self) -> Option<Self> {
        if other.whole == 0 && other.fractional == 0 {
            return None;
        }
        let a = self.to_precise_number()?;
        let b = other.to_precise_number()?;
        Self::from_precise_number(&a.checked_div(&b)?)
    }

    pub fn pow(&self, exponent: u128) -> Option<Self> {
        let a = self.to_precise_number()?;
        Self::from_precise_number(&a.checked_pow(exponent)?)
    }

    // Token amount conversions (keep as is since they're efficient)
    pub fn to_token_amount(&self, token_decimals: u8, rounding: Rounding) -> u64 {
        if token_decimals >= Self::DECIMAL_PLACES {
            return match rounding {
                Rounding::Floor => self.whole,
                Rounding::Ceil => {
                    if self.fractional > 0 {
                        self.whole.saturating_add(1)
                    } else {
                        self.whole
                    }
                }
            };
        }

        let scale_down = Self::DECIMAL_PLACES - token_decimals;
        let scale_factor = 10u128.pow(scale_down as u32);
        let value = self.to_u128();

        match rounding {
            Rounding::Floor => (value / scale_factor) as u64,
            Rounding::Ceil => {
                let remainder = value % scale_factor;
                let quotient = value / scale_factor;
                if remainder > 0 {
                    (quotient + 1) as u64
                } else {
                    quotient as u64
                }
            }
        }
    }

    pub fn add_sub(&self, add: &Self, sub: &Self) -> Option<Self> {
        self.add(add)?.sub(sub)
    }

    pub fn mul_div(&self, multiplier: &Self, divisor: &Self) -> Option<Self> {
        // First try to minimize intermediate values by dividing first when possible
        if self.to_u128() >= multiplier.to_u128() {
            // If self is larger than multiplier, divide self by divisor first
            self.div(divisor)?.mul(multiplier)
        } else {
            // If multiplier is larger, divide multiplier by divisor first
            multiplier.div(divisor)?.mul(self)
        }
    }
}
