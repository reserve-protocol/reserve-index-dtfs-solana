use anchor_lang::prelude::*;

use instructions::*;
use utils::*;

pub mod error;
pub mod events;
pub mod instructions;
pub mod state;
pub mod utils;

declare_id!("Cr1UEkStzJPQ4wa9Lr6ryJWci83baMvrQLT3skd1eLmG");

#[program]
pub mod dtfs {
    use super::*;
}
