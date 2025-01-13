#![allow(clippy::too_many_arguments)]
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
    #[allow(clippy::too_many_arguments)]
    pub fn init_folio(
        ctx: Context<InitFolio>,
        folio_fee: u64,
        minting_fee: u64,
        trade_delay: u64,
        auction_length: u64,
        name: String,
        symbol: String,
    ) -> Result<()> {
        init_folio::handler(
            ctx,
            folio_fee,
            minting_fee,
            trade_delay,
            auction_length,
            name,
            symbol,
        )
    }

    pub fn resize_folio(ctx: Context<ResizeFolio>, new_size: u64) -> Result<()> {
        resize_folio::handler(ctx, new_size)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn update_folio(
        ctx: Context<UpdateFolio>,
        program_version: Option<Pubkey>,
        program_deployment_slot: Option<u64>,
        folio_fee: Option<u64>,
        minting_fee: Option<u64>,
        trade_delay: Option<u64>,
        auction_length: Option<u64>,
        fee_recipients_to_add: Vec<FeeRecipient>,
        fee_recipients_to_remove: Vec<Pubkey>,
    ) -> Result<()> {
        update_folio::handler(
            ctx,
            program_version,
            program_deployment_slot,
            folio_fee,
            minting_fee,
            trade_delay,
            auction_length,
            fee_recipients_to_add,
            fee_recipients_to_remove,
        )
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

    pub fn add_to_basket<'info>(
        ctx: Context<'_, '_, 'info, 'info, AddToBasket<'info>>,
        amounts: Vec<u64>,
        initial_shares: Option<u64>,
    ) -> Result<()> {
        add_to_basket::handler(ctx, amounts, initial_shares)
    }

    pub fn kill_folio(ctx: Context<KillFolio>) -> Result<()> {
        kill_folio::handler(ctx)
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
        shares: u64,
    ) -> Result<()> {
        burn_folio_token::handler(ctx, shares)
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

    /*
    Crank functions
    */
    pub fn poke_folio<'info>(ctx: Context<'_, '_, 'info, 'info, PokeFolio<'info>>) -> Result<()> {
        poke_folio::handler(ctx)
    }

    pub fn distribute_fees<'info>(
        ctx: Context<'_, '_, 'info, 'info, DistributeFees<'info>>,
        index: u64,
    ) -> Result<()> {
        distribute_fees::handler(ctx, index)
    }

    pub fn crank_fee_distribution<'info>(
        ctx: Context<'_, '_, 'info, 'info, CrankFeeDistribution<'info>>,
        indices: Vec<u64>,
    ) -> Result<()> {
        crank_fee_distribution::handler(ctx, indices)
    }
}
