use anchor_lang::prelude::*;

use instructions::*;
use utils::*;

pub mod error;
pub mod events;
pub mod instructions;
pub mod state;
pub mod utils;

declare_id!("7ZqvG9KKhzA3ykto2WMYuw3waWuaydKwYKHYSf7SiFbn");

#[program]
pub mod dtfs {
    use super::*;

    pub fn init_first_owner(ctx: Context<InitFirstOwner>) -> Result<()> {
        init_first_owner::handler(ctx)
    }
}
