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

    pub fn update_folio(
        ctx: Context<UpdateFolio>,
        program_version: Option<Pubkey>,
        program_deployment_slot: Option<u64>,
        fee_per_second: Option<u64>,
        fee_recipients_to_add: Vec<Pubkey>,
        fee_recipients_to_remove: Vec<Pubkey>,
    ) -> Result<()> {
        update_folio::handler(
            ctx,
            program_version,
            program_deployment_slot,
            fee_per_second,
            fee_recipients_to_add,
            fee_recipients_to_remove,
        )
    }
}
