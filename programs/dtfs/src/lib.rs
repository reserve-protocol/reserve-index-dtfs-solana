use anchor_lang::prelude::*;

use instructions::*;
use shared::structs::FeeRecipient;
use shared::structs::Role;
use utils::*;
pub mod events;
pub mod instructions;
pub mod state;
pub mod utils;

declare_id!("7ZqvG9KKhzA3ykto2WMYuw3waWuaydKwYKHYSf7SiFbn");

#[program]
pub mod dtfs {

    use shared::structs::TokenAmount;

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
        fee_recipients_to_add: Vec<FeeRecipient>,
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

    /*
    Owner functions
     */
    pub fn init_or_update_actor(ctx: Context<InitOrUpdateActor>, role: Role) -> Result<()> {
        init_or_update_actor::handler(ctx, role)
    }

    pub fn remove_actor(ctx: Context<RemoveActor>, role: Role, close_actor: bool) -> Result<()> {
        remove_actor::handler(ctx, role, close_actor)
    }

    pub fn add_tokens_to_folio<'info>(
        ctx: Context<'_, '_, 'info, 'info, AddTokensToFolio<'info>>,
    ) -> Result<()> {
        add_tokens_to_folio::handler(ctx)
    }

    pub fn finalize_folio(ctx: Context<FinalizeFolio>, initial_shares: u64) -> Result<()> {
        finalize_folio::handler(ctx, initial_shares)
    }

    /*
    User functions
     */
    pub fn init_or_add_mint_folio_token<'info>(
        ctx: Context<'_, '_, 'info, 'info, InitOrAddMintFolioToken<'info>>,
        amounts: Vec<u64>,
    ) -> Result<()> {
        init_or_add_mint_folio_token::handler(ctx, amounts)
    }

    pub fn remove_from_mint_folio_token<'info>(
        ctx: Context<'_, '_, 'info, 'info, RemoveFromMintFolioToken<'info>>,
        amounts: Vec<u64>,
    ) -> Result<()> {
        remove_from_mint_folio_token::handler(ctx, amounts)
    }

    pub fn mint_folio_token<'info>(
        ctx: Context<'_, '_, 'info, 'info, MintFolioToken<'info>>,
        shares: u64,
    ) -> Result<()> {
        mint_folio_token::handler(ctx, shares)
    }
}
