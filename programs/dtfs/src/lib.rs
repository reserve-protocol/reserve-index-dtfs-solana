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
    pub fn resize_folio(ctx: Context<ResizeFolio>, new_size: u64) -> Result<()> {
        resize_folio::handler(ctx, new_size)
    }

    pub fn update_folio(
        ctx: Context<UpdateFolio>,
        program_version: Option<Pubkey>,
        program_deployment_slot: Option<u64>,
        folio_fee: Option<u64>,
        fee_recipients_to_add: Vec<FeeRecipient>,
        fee_recipients_to_remove: Vec<Pubkey>,
    ) -> Result<()> {
        update_folio::handler(
            ctx,
            program_version,
            program_deployment_slot,
            folio_fee,
            fee_recipients_to_add,
            fee_recipients_to_remove,
        )
    }

    /*
    Owner functions
     */
    pub fn init_or_update_actor<'info>(
        ctx: Context<'_, '_, 'info, 'info, InitOrUpdateActor<'info>>,
        role: Role,
    ) -> Result<()> {
        init_or_update_actor::handler(ctx, role)
    }

    pub fn remove_actor<'info>(
        ctx: Context<'_, '_, 'info, 'info, RemoveActor<'info>>,
        role: Role,
        close_actor: bool,
    ) -> Result<()> {
        remove_actor::handler(ctx, role, close_actor)
    }

    pub fn add_to_basket<'info>(
        ctx: Context<'_, '_, 'info, 'info, AddToBasket<'info>>,
        amounts: Vec<u64>,
    ) -> Result<()> {
        add_to_basket::handler(ctx, amounts)
    }

    pub fn finalize_basket(ctx: Context<FinalizeBasket>, initial_shares: u64) -> Result<()> {
        finalize_basket::handler(ctx, initial_shares)
    }

    /*
    User functions
     */
    pub fn add_to_pending_basket<'info>(
        ctx: Context<'_, '_, 'info, 'info, AddToPendingBasket<'info>>,
        amounts: Vec<u64>,
    ) -> Result<()> {
        add_to_pending_basket::handler(ctx, amounts)
    }

    pub fn remove_from_pending_basket<'info>(
        ctx: Context<'_, '_, 'info, 'info, RemoveFromPendingBasket<'info>>,
        amounts: Vec<u64>,
    ) -> Result<()> {
        remove_from_pending_basket::handler(ctx, amounts)
    }

    pub fn mint_folio_token<'info>(
        ctx: Context<'_, '_, 'info, 'info, MintFolioToken<'info>>,
        shares: u64,
    ) -> Result<()> {
        mint_folio_token::handler(ctx, shares)
    }

    pub fn burn_folio_token<'info>(
        ctx: Context<'_, '_, 'info, 'info, BurnFolioToken<'info>>,
        amount_to_burn: u64,
    ) -> Result<()> {
        burn_folio_token::handler(ctx, amount_to_burn)
    }

    pub fn redeem_from_pending_basket<'info>(
        ctx: Context<'_, '_, 'info, 'info, RedeemFromPendingBasket<'info>>,
        amounts: Vec<u64>,
    ) -> Result<()> {
        redeem_from_pending_basket::handler(ctx, amounts)
    }

    pub fn close_pending_token_amount<'info>(
        ctx: Context<'_, '_, 'info, 'info, ClosePendingTokenAmount<'info>>,
    ) -> Result<()> {
        close_pending_token_amount::handler(ctx)
    }
}
