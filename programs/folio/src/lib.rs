use anchor_lang::prelude::*;

use instructions::*;
use shared::structs::{FeeRecipient, Role};
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

    pub fn init_or_update_community(ctx: Context<InitOrUpdateCommunity>) -> Result<()> {
        init_or_update_community::handler(ctx)
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

    pub fn resize_folio_account(ctx: Context<ResizeFolioAccount>, new_size: u64) -> Result<()> {
        resize_folio_account::handler(ctx, new_size)
    }

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

    pub fn init_tokens_for_folio<'info>(
        ctx: Context<'_, '_, 'info, 'info, InitTokensForFolio<'info>>,
        amounts: Vec<u64>,
    ) -> Result<()> {
        init_tokens_for_folio::handler(ctx, amounts)
    }

    pub fn finish_init_tokens_for_folio(
        ctx: Context<FinishInitTokensForFolio>,
        initial_shares: u64,
    ) -> Result<()> {
        finish_init_tokens_for_folio::handler(ctx, initial_shares)
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

    pub fn transfer_folio_token(ctx: Context<TransferFolioToken>) -> Result<()> {
        transfer_folio_token::handler(ctx)
    }

    pub fn mint_folio_token<'info>(
        ctx: Context<'_, '_, 'info, 'info, MintFolioToken<'info>>,
        shares: u64,
    ) -> Result<()> {
        mint_folio_token::handler(ctx, shares)
    }

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

    pub fn close_pending_token_amount<'info>(
        ctx: Context<'_, '_, 'info, 'info, ClosePendingTokenAmount<'info>>,
    ) -> Result<()> {
        close_pending_token_amount::handler(ctx)
    }

    pub fn burn_folio_token<'info>(
        ctx: Context<'_, '_, 'info, 'info, BurnFolioToken<'info>>,
        amount_to_burn: u64,
    ) -> Result<()> {
        burn_folio_token::handler(ctx, amount_to_burn)
    }

    pub fn redeem_from_burn_folio_token<'info>(
        ctx: Context<'_, '_, 'info, 'info, RedeemFromBurnFolioToken<'info>>,
        amounts: Vec<u64>,
    ) -> Result<()> {
        redeem_from_burn_folio_token::handler(ctx, amounts)
    }
}
