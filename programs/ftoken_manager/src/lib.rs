use anchor_lang::prelude::*;

use instructions::*;
use utils::*;

pub mod error;
pub mod events;
pub mod instructions;
pub mod state;
pub mod utils;

declare_id!("FESnpQMqnsixE1MU4xZMLiLQGErg7JdqjmtjgWsvQ55m");

#[program]
pub mod ftoken_manager {
    use super::*;
}
