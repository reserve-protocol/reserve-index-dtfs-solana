use anchor_lang::prelude::*;

/// PDA Seeds ["example", wallet]
#[account]
#[derive(Default)]
pub struct ExampleAccount {
    pub bump: u8,

    pub example_field: u64,
}

impl ExampleAccount {
    pub const SIZE: usize = 8 + 1 + 8;

    pub const SEEDS: &'static [u8] = b"example";
}
