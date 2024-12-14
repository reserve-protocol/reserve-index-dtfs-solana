use anchor_lang::prelude::*;

use instructions::*;
use utils::*;

pub mod events;
pub mod instructions;
pub mod state;
pub mod utils;

declare_id!("n6sR7Eg5LMg5SGorxK9q3ZePHs9e8gjoQ7TgUW2YCaG");

#[program]
pub mod folio {
    use super::*;

    /*
    Admin functions
    */
    pub fn init_folio_signer(ctx: Context<InitFolioSigner>) -> Result<()> {
        init_folio_signer::handler(ctx)
    }

    pub fn init_program_registrar(
        ctx: Context<InitProgramRegistrar>,
        program_id: Pubkey,
    ) -> Result<()> {
        init_program_registrar::handler(ctx, program_id)
    }

    pub fn update_program_registrar(
        ctx: Context<UpdateProgramRegistrar>,
        program_ids: Vec<Pubkey>,
        remove: bool,
    ) -> Result<()> {
        update_program_registrar::handler(ctx, program_ids, remove)
    }

    /*
    Folio functions
    */
    pub fn init_folio(ctx: Context<InitFolio>, fee_per_second: u64) -> Result<()> {
        init_folio::handler(ctx, fee_per_second)
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

    pub fn transfer_folio_token(ctx: Context<TransferFolioToken>) -> Result<()> {
        transfer_folio_token::handler(ctx)
    }

    pub fn mint_folio_token(ctx: Context<MintFolioToken>) -> Result<()> {
        mint_folio_token::handler(ctx)
    }

    pub fn burn_folio_token(ctx: Context<BurnFolioToken>) -> Result<()> {
        burn_folio_token::handler(ctx)
    }

    pub fn resize_folio_account(ctx: Context<ResizeFolioAccount>, new_size: u64) -> Result<()> {
        resize_folio_account::handler(ctx, new_size)
    }
}
