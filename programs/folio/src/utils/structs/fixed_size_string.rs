use anchor_lang::prelude::*;
use bytemuck::{Pod, Zeroable};

pub const MAX_PADDED_STRING_LENGTH: usize = 128;

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
    pub fn new(input: &str) -> Self {
        let mut value = [0u8; MAX_PADDED_STRING_LENGTH];

        let bytes = input.as_bytes();

        let length = bytes.len().min(MAX_PADDED_STRING_LENGTH) as u8;

        value[..length as usize].copy_from_slice(&bytes[..length as usize]);

        Self { value }
    }
}
