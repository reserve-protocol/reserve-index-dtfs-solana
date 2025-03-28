use std::cmp::Ordering;

use crate::constants::{D18_U256, D9_U256, ONE_U256};
use crate::errors::ErrorCode::MathOverflow;
use anchor_lang::prelude::*;
use spl_math::uint::U256;

/// The rounding mode for the math operations
pub enum Rounding {
    Floor,
    Ceiling,
}

#[derive(Debug, Clone)]
/// Scaled in D18
pub struct Decimal(pub U256);

#[derive(Debug, Clone)]
/// Scaled in D9
pub struct TokenResult(pub u64);

/// Trait to convert a type to a U256
pub trait IntoU256 {
    fn into_u256(self) -> U256;
}

/// Implementation of the IntoU256 trait for u64
impl IntoU256 for u64 {
    fn into_u256(self) -> U256 {
        U256::from(self)
    }
}

/// Implementation of the IntoU256 trait for u128
impl IntoU256 for u128 {
    fn into_u256(self) -> U256 {
        U256::from(self)
    }
}

/// Implementation of the IntoU256 trait for U256
impl IntoU256 for U256 {
    fn into_u256(self) -> U256 {
        self
    }
}

/// Implementation of the PartialEq trait for Decimal
impl PartialEq for Decimal {
    fn eq(&self, other: &Self) -> bool {
        self.0 == other.0
    }
}

/// Implementation of the Eq trait for Decimal
impl Eq for Decimal {}

/// Implementation of the PartialOrd trait for Decimal
impl PartialOrd for Decimal {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.0.cmp(&other.0))
    }
}

/// Implementation of the Ord trait for Decimal
impl Ord for Decimal {
    fn cmp(&self, other: &Self) -> Ordering {
        self.0.cmp(&other.0)
    }
}

impl Decimal {
    /// The zero decimal
    pub const ZERO: Self = Self(U256([0, 0, 0, 0]));
    /// The one decimal
    pub const ONE: Self = Self(ONE_U256);
    /// The one scaled in D18 (1e18)
    pub const ONE_E18: Self = Self(D18_U256);
}

impl Decimal {
    /// Create a new Decimal from a plain value, meaning it's not scaled at all. So will scale it in D18.
    ///
    /// # Arguments
    /// * `value` - The plain value to create the Decimal from
    ///
    /// Returns the Decimal in D18
    pub fn from_plain(value: u64) -> Result<Self> {
        Ok(Decimal(
            U256::from(value)
                .checked_mul(D18_U256)
                .ok_or(MathOverflow)?,
        ))
    }

    /// Create a new Decimal from a token amount, meaning it's scaled in D9, so we need to scale it in D18.
    ///
    /// # Arguments
    /// * `value` - The token amount to create the Decimal from (D9)
    ///
    /// Returns the Decimal in D18
    pub fn from_token_amount<T: IntoU256>(value: T) -> Result<Self> {
        let result = value.into_u256().checked_mul(D9_U256).ok_or(MathOverflow)?;

        Ok(Decimal(result))
    }

    /// Create a new Decimal from a scaled value, meaning it's already in D18.
    ///
    /// # Arguments
    /// * `value` - The scaled value to create the Decimal from
    ///
    /// Returns the Decimal in D18
    pub fn from_scaled<T: IntoU256>(value: T) -> Self {
        let result = value.into_u256();

        Decimal(result)
    }
}

impl Decimal {
    /// Convert a Decimal in D18 to a token amount (so scaled in D9), as a u64.
    /// So that it can be used in functions that require token balances.
    ///
    /// # Arguments
    /// * `rounding` - The rounding mode
    ///
    /// Returns the token amount in D9
    pub fn to_token_amount(&self, rounding: Rounding) -> Result<TokenResult> {
        let value = match rounding {
            Rounding::Floor => self.0.checked_div(D9_U256).ok_or(MathOverflow)?,
            Rounding::Ceiling => {
                // Only round up if there's a remainder after division
                if self.0 % D9_U256 == U256::from(0) {
                    self.0.checked_div(D9_U256).ok_or(MathOverflow)?
                } else {
                    self.0
                        .checked_add(D9_U256.checked_sub(U256::from(1)).ok_or(MathOverflow)?)
                        .ok_or(MathOverflow)?
                        .checked_div(D9_U256)
                        .ok_or(MathOverflow)?
                }
            }
        };

        // If the value is greater than the max u64, return the max u64
        Ok(if value > U256::from(u64::MAX) {
            TokenResult(u64::MAX)
        } else {
            TokenResult(value.as_u64())
        })
    }

    /// Convert a Decimal in D18 to a scaled value (so in D18), as a u128.
    /// So that it can be used in functions that require scaled values.
    ///
    /// # Arguments
    /// * `rounding` - The rounding mode
    ///
    /// Returns the scaled value in D18
    pub fn to_scaled(&self, rounding: Rounding) -> Result<u128> {
        let value = match rounding {
            Rounding::Floor => self.0,
            Rounding::Ceiling => {
                // Only add 1 if there's a fractional part
                if self.0 % Decimal::ONE_E18.0 == U256::from(0) {
                    self.0
                } else {
                    self.0.checked_add(U256::from(1)).ok_or(MathOverflow)?
                }
            }
        };

        // If the value is greater than the max u128, return the max u128
        Ok(if value > U256::from(u128::MAX) {
            u128::MAX
        } else {
            value.as_u128()
        })
    }
}

impl Decimal {
    /// Add two Decimals.
    ///
    /// # Arguments
    /// * `other` - The other Decimal to add
    ///
    /// Returns the sum of the two Decimals
    pub fn add(&self, other: &Self) -> Result<Self> {
        let result = self.0.checked_add(other.0).ok_or(MathOverflow)?;

        Ok(Decimal(result))
    }

    /// Subtract two Decimals.
    ///
    /// # Arguments
    /// * `other` - The other Decimal to subtract
    ///
    /// Returns the difference of the two Decimals
    pub fn sub(&self, other: &Self) -> Result<Self> {
        let result = self.0.checked_sub(other.0).ok_or(MathOverflow)?;

        Ok(Decimal(result))
    }

    /// Multiply two Decimals.
    /// This multiplication is done from a 1eX multiplied by a 1eY, so the result is a 1e(X+Y). So depending on the scale of the numbers,
    /// the result might be in D18, D36, D54, etc., no automatic scaling back is done.
    ///
    /// # Arguments
    /// * `other` - The other Decimal to multiply
    ///
    /// Returns the product of the two Decimals
    pub fn mul(&self, other: &Self) -> Result<Self> {
        let result = self.0.checked_mul(other.0).ok_or(MathOverflow)?;

        Ok(Decimal(result))
    }

    /// Divide two Decimals.
    /// This division is done from a 1eX divided by a 1eY, so the result is a 1e(X-Y). So depending on the scale of the numbers,
    /// the result might be in D18, etc., no automatic scaling back is done.
    ///
    /// # Arguments
    /// * `other` - The other Decimal to divide
    ///
    /// Returns the quotient of the two Decimals
    pub fn div(&self, other: &Self) -> Result<Self> {
        let result = self.0.checked_div(other.0).ok_or(MathOverflow)?;

        Ok(Decimal(result))
    }

    // Raise a Decimal to a power using binary exponentiation (also known as square-and-multiply).
    /// This is an efficient algorithm that computes x^n using O(log n) multiplications.
    ///
    /// The algorithm works by:
    /// 1. Converting the exponent to binary form
    /// 2. For each bit in the binary representation:
    ///    - If the bit is 1, multiply the result by the current base
    ///    - Square the base for the next iteration
    /// 3. Maintains decimal scaling by dividing by ONE_E18 after each multiplication
    ///
    /// # Arguments
    /// * `exponent` - The power to raise the Decimal to (must be a non-negative integer)
    ///
    /// # Returns
    /// * `Result<Self>` - The result of x^exponent, properly scaled in D18
    pub fn pow(&self, exponent: u64) -> Result<Self> {
        // If the exponent is 0, return 1e18
        if exponent == 0 {
            return Ok(Decimal::ONE_E18);
        }

        // If the exponent is 1, return the Decimal itself
        if exponent == 1 {
            return Ok(self.clone());
        }

        let mut base = self.clone();
        let mut result = Decimal::ONE_E18;
        let mut exp = exponent;

        while exp > 0 {
            if exp & 1 == 1 {
                result = result.mul(&base)?.div(&Decimal::ONE_E18)?;
            }
            if exp > 1 {
                base = base.mul(&base)?.div(&Decimal::ONE_E18)?;
            }

            // Shift the exponent to the right by 1, to divide it by 2
            exp >>= 1;
        }

        Ok(result)
    }

    /// Check if the Decimal is zero
    ///
    /// # Returns
    /// * `bool` - True if the Decimal is zero, false otherwise
    pub fn is_zero(&self) -> bool {
        self.0 == U256::from(0)
    }
}

impl Decimal {
    /// The maximum number of iterations for the ln and exp functions
    const MAX_ITERATIONS: usize = 100;

    /// The epsilon value for the ln and exp functions
    /// This is used to determine when to stop the iteration
    /// It's 1e-18 in D18
    const EPSILON: U256 = U256([1, 0, 0, 0]);

    /// The upper bound for the nth root function, to decide which algorithm to use
    const NTH_ROOT_UPPER_BOUND: u64 = 1_000_000;

    /// The maximum number of iterations for the nth root function
    const NTH_ROOT_MAX_ITERATIONS: usize = 15;

    /// The e constant in D18
    pub const E: U256 = U256([2_718_281_828_459_045_235, 0, 0, 0]);

    /// Calculates the nth root of a Decimal number using two different approaches based on the value of n.
    ///
    /// The algorithm uses two methods:
    /// 1. For large n (> 1,000,000):
    ///    - Uses a Taylor series approximation around x = 1
    ///    - Computes using first three terms of the series expansion
    ///    - Provides good accuracy for values close to 1
    ///
    /// 2. For smaller n:
    ///    - Uses binary search method with fixed iterations
    ///    - Iteratively narrows down the root value
    ///    - Maintains decimal scaling throughout calculations
    ///
    /// # Arguments
    /// * `n` - The root to calculate (e.g., 2 for square root, 3 for cube root)
    ///
    /// # Returns
    /// * `Result<Self>` - The nth root of the number, properly scaled in D18
    pub fn nth_root(&self, n: u64) -> Result<Self> {
        if self.0 == Decimal::ZERO.0 {
            return Ok(Decimal::ZERO);
        }
        if self.0 == Decimal::ONE_E18.0 {
            return Ok(Decimal::ONE_E18);
        }

        if n > Self::NTH_ROOT_UPPER_BOUND {
            let x = Decimal::ONE_E18.sub(self)?;

            /*
            First term
            */
            // Use from_scaled to keep n's raw value
            let n_decimal = Decimal::from_scaled(n);
            let first_term = x.div(&n_decimal)?;

            /*
            Second term
             */
            let x_squared = x.mul(&x)?; // D36

            let n_value = n.checked_mul(n).ok_or(MathOverflow)?;

            // Use (n-1) in numerator
            let n_minus_one = n.checked_sub(1).ok_or(MathOverflow)?;

            // Calculate second term with correct coefficient
            let second_term = x_squared // D36
                .mul(&Decimal::from_scaled(n_minus_one))? // Multiply by (n-1)
                .div(&Decimal::ONE_E18)? // Scale down
                .div(&Decimal::from_scaled(n_value))? // Divide by n²
                .div(&Decimal::from_scaled(2u128))?; // Divide by 2

            /*
            Third term
             */
            let x_cubed = x_squared.mul(&x)?; // D36 * D18 = D54

            // Calculate (n-1)(n-2)
            let n_minus_two = n.checked_sub(2).ok_or(MathOverflow)?;
            let numerator = n_minus_one.checked_mul(n_minus_two).ok_or(MathOverflow)?;

            // Calculate n³
            let n_cubed = (n_value as u128)
                .checked_mul(n as u128)
                .ok_or(MathOverflow)?;

            let n_cubed_decimal = Decimal::from_scaled(n_cubed);

            let third_term = x_cubed // D54
                .mul(&Decimal::from_scaled(numerator))? // Multiply by (n-1)(n-2)
                .div(&Decimal::ONE_E18)? // Scale down to D54
                .div(&Decimal::ONE_E18)? // Scale down to D54
                .div(&n_cubed_decimal)? // Divide by n³
                .div(&Decimal::from_scaled(6u128))?; // Divide by 6

            let result = Decimal::ONE_E18
                .sub(&first_term)?
                .sub(&second_term)?
                .sub(&third_term)?;

            return Ok(result);
        }

        // For other cases use binary search with limited iterations
        let mut low = Decimal::ZERO; // D18
        let mut high = if self.0 > Decimal::ONE_E18.0 {
            self.clone() // D18
        } else {
            Decimal::ONE_E18 // D18
        };
        let target = self.clone(); // D18
        let two = &Decimal::from_scaled(2u128); // D18

        for _ in 0..Self::NTH_ROOT_MAX_ITERATIONS {
            let mid = low.add(&high)?.div(two)?; // D18
            let mut mid_pow = mid.clone(); // D18

            for _ in 1..n {
                mid_pow = mid_pow.mul(&mid)?.div(&Decimal::ONE_E18)?; // Keep at D18
            }

            match mid_pow.cmp(&target) {
                Ordering::Greater => high = mid,
                Ordering::Less => low = mid,
                Ordering::Equal => return Ok(mid),
            }
        }

        low.add(&high)?.div(two) // Final result in D18
    }

    /// Calculates the natural logarithm (ln) of a Decimal number.
    /// Uses a combination of normalization and Taylor series expansion.
    ///
    /// The algorithm works by:
    /// 1. Normalizing the input to be between 1 and e by multiplying/dividing by e
    /// 2. Using the formula ln((1+x)/(1-x)) = 2 * arctanh(x)
    /// 3. Computing arctanh using its Taylor series expansion
    /// 4. Adjusting the result based on the normalization power
    ///
    /// # Returns
    /// * `Result<Option<Self>>` - The natural logarithm of the number in D18 scaling, or None if input is 0
    pub fn ln(&self) -> Result<Option<Self>> {
        let one = Decimal::ONE_E18;

        let zero = Decimal(U256::from(0));

        if self.0 == one.0 {
            return Ok(Some(zero));
        }

        if self.0.is_zero() {
            return Ok(None);
        }

        let mut normalized = self.clone();
        let e = Decimal::from_scaled(Self::E);
        let mut power = 0i32;

        // Handle numbers < 1 by multiplying by e until >= 1
        while normalized.0 < one.0 {
            // D18 x D18 = D36, so we need to div by D18
            normalized = normalized.mul(&e)?.div(&one)?;
            power -= 1;
        }

        // Handle numbers > e by dividing by e until < e
        while normalized.0 >= e.0 {
            // D18 / D18 = D0, so we need to mul by D18
            normalized = normalized.mul(&one)?.div(&e)?;
            power += 1;
        }

        let numerator = normalized.sub(&one)?;
        let denominator = normalized.add(&one)?;

        // D18 x D18 = D36, so we need to div by D18
        let z = numerator.mul(&one)?.div(&denominator)?;

        // D18 x D18 = D36, so we need to div by D18
        let z_squared = z.mul(&z)?.div(&one)?;

        let mut term = z.clone();
        let mut result = Decimal(U256::from(0));
        let mut n = 1u64;

        while n <= Self::MAX_ITERATIONS as u64 {
            result = result.add(&term.div(&Decimal::from_scaled(2 * n - 1))?)?;

            // D18 x D18 = D36, so we need to div by D18
            term = term.mul(&z_squared)?.div(&one)?;

            if term.0 < Self::EPSILON {
                break;
            }
            n += 1;
        }

        let mut final_result = result.mul(&Decimal::from_scaled(2u128))?;

        if power != 0 {
            // one (D18) * plain number = D18
            let power_term = one.mul(&Decimal::from_scaled(power.unsigned_abs() as u64))?;

            if power > 0 {
                final_result = final_result.add(&power_term)?;
            } else {
                final_result = final_result.sub(&power_term)?;
            }
        }

        // Scale result by D18
        final_result = Decimal(final_result.0);

        Ok(Some(final_result))
    }

    /// Calculates e raised to the power of the Decimal number (e^x).
    /// Uses Taylor series expansion to compute the result.
    ///
    /// The algorithm works by:
    /// 1. Computing the Taylor series: e^x = 1 + x + x²/2! + x³/3! + ...
    /// 2. Continuing until the terms become smaller than epsilon
    /// 3. Optionally negating the result (computing e^-x) if requested
    ///
    /// # Arguments
    /// * `negate_result` - If true, returns e^-x instead of e^x
    ///
    /// # Returns
    /// * `Result<Option<Self>>` - e raised to the power of the number in D18 scaling
    pub fn exp(&self, negate_result: bool) -> Result<Option<Self>> {
        if self.0 == U256::from(0) {
            return Ok(Some(Decimal::ONE_E18));
        }

        let mut term = Decimal::ONE_E18;
        let mut result = term.clone();
        let mut n = 1u64;

        while n <= Self::MAX_ITERATIONS as u64 {
            term = term.mul(self)?.div(&Decimal::from_plain(n)?)?;
            result = result.add(&term)?;

            if term.0 < Self::EPSILON {
                break;
            }

            n += 1;
        }

        if negate_result {
            //e^(-x) = 1/(e^x)
            Ok(Some(Decimal(
                D18_U256
                    .checked_mul(D18_U256)
                    .ok_or(MathOverflow)?
                    .checked_div(result.0)
                    .ok_or(MathOverflow)?,
            )))
        } else {
            Ok(Some(result))
        }
    }
}
