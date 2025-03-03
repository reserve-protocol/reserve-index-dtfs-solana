use anchor_lang::prelude::*;
use bytemuck::{Pod, Zeroable};

/// The maximum length of a fixed size string in bytes.
pub const MAX_PADDED_STRING_LENGTH: usize = 128;

/// A fixed size string with a maximum length of 128 bytes.
///
/// Padding is added to the end of the string to ensure it is 128 bytes long, in order
/// to simplify memcmp operations when fetching accounts.
#[derive(InitSpace, Debug, Clone, Copy, AnchorSerialize, AnchorDeserialize, Pod, Zeroable)]
#[repr(C)]
pub struct FixedSizeString {
    pub value: [u8; MAX_PADDED_STRING_LENGTH],
}

impl Default for FixedSizeString {
    fn default() -> Self {
        Self {
            value: [0u8; MAX_PADDED_STRING_LENGTH],
        }
    }
}

impl FixedSizeString {
    /// Creates a new FixedSizeString from a string.
    /// Will truncate the string if it is longer than the maximum length.
    ///
    /// # Arguments
    /// * `input`: The string to convert.
    ///
    /// # Returns
    /// * `FixedSizeString`: The new FixedSizeString.
    pub fn new(input: &str) -> Self {
        let mut value = [0u8; MAX_PADDED_STRING_LENGTH];

        let bytes = input.as_bytes();

        let length = bytes.len().min(MAX_PADDED_STRING_LENGTH) as u8;

        value[..length as usize].copy_from_slice(&bytes[..length as usize]);

        Self { value }
    }
}
