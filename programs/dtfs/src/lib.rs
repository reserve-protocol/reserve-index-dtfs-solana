use anchor_lang::prelude::*;

use instructions::*;
use shared::structs::FeeRecipient;
use shared::structs::Range;
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

    pub fn set_dao_fee_config(
        ctx: Context<SetDAOFeeConfig>,
        fee_recipient: Option<Pubkey>,
        fee_recipient_numerator: Option<u128>,
    ) -> Result<()> {
        set_dao_fee_config::handler(ctx, fee_recipient, fee_recipient_numerator)
    }

    /*
    Folio Program functions
     */
    pub fn resize_folio(ctx: Context<ResizeFolio>, new_size: u64) -> Result<()> {
        resize_folio::handler(ctx, new_size)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn update_folio(
        ctx: Context<UpdateFolio>,
        program_version: Option<Pubkey>,
        program_deployment_slot: Option<u64>,
        folio_fee: Option<u128>,
        minting_fee: Option<u128>,
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
        initial_shares: Option<u64>,
    ) -> Result<()> {
        add_to_basket::handler(ctx, amounts, initial_shares)
    }

    pub fn remove_from_basket<'info>(
        ctx: Context<'_, '_, 'info, 'info, RemoveFromBasket<'info>>,
        removed_mints: Vec<Pubkey>,
    ) -> Result<()> {
        remove_from_basket::handler(ctx, removed_mints)
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

    pub fn close_user_pending_token_amount<'info>(
        ctx: Context<'_, '_, 'info, 'info, CloseUserPendingTokenAmount<'info>>,
    ) -> Result<()> {
        close_user_pending_token_amount::handler(ctx)
    }

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

    /*
    Trade functions
     */
    pub fn approve_trade(
        ctx: Context<ApproveTrade>,
        trade_id: u64,
        sell_limit: Range,
        buy_limit: Range,
        start_price: u128,
        end_price: u128,
        ttl: u64,
    ) -> Result<()> {
        approve_trade::handler(
            ctx,
            trade_id,
            sell_limit,
            buy_limit,
            start_price,
            end_price,
            ttl,
        )
    }

    pub fn kill_trade(ctx: Context<KillTrade>) -> Result<()> {
        kill_trade::handler(ctx)
    }

    pub fn open_trade(
        ctx: Context<OpenTrade>,
        sell_limit: u128,
        buy_limit: u128,
        start_price: u128,
        end_price: u128,
    ) -> Result<()> {
        open_trade::handler(ctx, sell_limit, buy_limit, start_price, end_price)
    }

    pub fn open_trade_permissionless(ctx: Context<OpenTradePermissionless>) -> Result<()> {
        open_trade_permissionless::handler(ctx)
    }

    pub fn bid<'info>(
        ctx: Context<'_, '_, 'info, 'info, Bid<'info>>,
        sell_amount: u64,
        max_buy_amount: u64,
        with_callback: bool,
        callback_data: Vec<u8>,
    ) -> Result<()> {
        bid::handler(
            ctx,
            sell_amount,
            max_buy_amount,
            with_callback,
            callback_data,
        )
    }

    pub fn init_or_set_reward_ratio<'info>(
        ctx: Context<'_, '_, 'info, 'info, InitOrSetRewardRatio<'info>>,
        reward_period: u64,
    ) -> Result<()> {
        init_or_set_reward_ratio::handler(ctx, reward_period)
    }

    pub fn add_reward_token<'info>(
        ctx: Context<'_, '_, 'info, 'info, AddRewardToken<'info>>,
        reward_period: u64,
    ) -> Result<()> {
        add_reward_token::handler(ctx, reward_period)
    }

    pub fn remove_reward_token<'info>(
        ctx: Context<'_, '_, 'info, 'info, RemoveRewardToken<'info>>,
    ) -> Result<()> {
        remove_reward_token::handler(ctx)
    }

    pub fn claim_rewards<'info>(
        ctx: Context<'_, '_, 'info, 'info, ClaimRewards<'info>>,
    ) -> Result<()> {
        claim_rewards::handler(ctx)
    }

    pub fn accrue_rewards<'info>(
        ctx: Context<'_, '_, 'info, 'info, AccrueRewards<'info>>,
    ) -> Result<()> {
        accrue_rewards::handler(ctx)
    }
}
