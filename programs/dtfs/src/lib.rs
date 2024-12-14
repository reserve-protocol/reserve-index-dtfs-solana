use anchor_lang::prelude::*;

use instructions::*;
use utils::*;

pub mod events;
pub mod instructions;
pub mod state;
pub mod utils;

declare_id!("7ZqvG9KKhzA3ykto2WMYuw3waWuaydKwYKHYSf7SiFbn");

#[program]
pub mod dtfs {
    use super::*;

    /*
    Admin functions
     */
    pub fn init_dtf_signer(ctx: Context<InitDtfSigner>) -> Result<()> {
        init_dtf_signer::handler(ctx)
    }

    /*
    Folio Program functions
     */
    pub fn init_first_owner(ctx: Context<InitFirstOwner>) -> Result<()> {
        init_first_owner::handler(ctx)
    }

    pub fn resize_folio(ctx: Context<ResizeFolio>, new_size: u64) -> Result<()> {
        resize_folio::handler(ctx, new_size)
    }
}
