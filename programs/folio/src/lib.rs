//! Folio Program
//!
//! This program is used to
//!     - Create, update, and manage folios.
//!     - Accumulate and distribute fees.
//!     - Conduct auctions.
//!     - Buy into and redeem from folios.
//!     - Migrate between different folio versions.
//!     - Reward token distribution.
//!
//! ** Also has a `declare_id` with a feature flag "dev" to allow for easy local testing between
//! ** different versions of the program.
//!
//! # Auction lifecycle:
//! * `approveAuction` then `openAuction` then `bid` then `[optional] closeAuction`
//!
//! Auctions will attempt to close themselves once the sell token's balance reaches the sellLimit. However, they can
//! also be closed by *any* of the 3 roles, if it is discovered one of the exchange rates has been set incorrectly.
//!
//! # Instructions
//!
//! * `init_folio` - Initialize a folio.
//! * `resize_folio` - Resize a folio (data size).
//! * `update_folio` - Update a folio.
//! * `init_or_update_actor` - Initialize or update an actor.
//! * `remove_actor` - Remove an actor with the possibility to close the actor account.
//! * `add_to_basket` - Add tokens to the basket of a Folio, as well as mint the initial shares of the Folio.
//! * `remove_from_basket` - Remove tokens from the basket of a Folio.
//! * `kill_folio` - Kill a folio, which means prevent any further minting.
//! * `start_folio_migration` - Start a folio migration, which means moving the folio to a new version of the folio program.
//! * `migrate_folio_tokens` - Migrate the tokens of a folio to the new version of the folio in the new folio program.
//! * `add_to_pending_basket` - Add tokens to the pending basket of a user trying to mint shares of a folio.
//! * `remove_from_pending_basket` - Remove tokens from the pending basket of a user trying to mint shares of a folio.
//! * `mint_folio_token` - Mint shares of the folio token to a user.
//! * `burn_folio_token` - Burn shares of the folio token from a user (to redeem).
//! * `redeem_from_pending_basket` - Redeem tokens from the pending basket of a user redeeming shares of a folio.
//! * `close_user_pending_token_amount` - Close the pending token amount account of a user (to get back rent).
//! * `poke_folio` - Poke a folio, which means update dao pending fee shares as well as fee recipients pending fee shares.
//! * `distribute_fees` - Creates a fee distribution account that will be used to distribute fees to the fee recipients, also distributes the fee to the DAO.
//! * `crank_fee_distribution` - Crank the fee distribution, which means distributing the fees to the fee recipients of a folio.
//! * `approve_auction` - Approve an auction.
//! * `open_auction` - Open an auction.
//! * `close_auction` - Close an auction.
//! * `open_auction_permissionless` - Open an auction permissionlessly (after a delay, if not done by allowed actors).
//! * `bid` - Bid in an auction.
//! * `init_or_set_reward_ratio` - Initialize or set the reward ratio of a folio.
//! * `add_reward_token` - Add a tracked reward token to a folio.
//! * `remove_reward_token` - Remove a tracked reward token from a folio.
//! * `claim_rewards` - Claim rewards from a folio tokens, which means transferring the rewards accrued by a user to the user.
//! * `accrue_rewards` - Accrue rewards to a folio, meaning updating accrued rewards.
#![allow(clippy::too_many_arguments)]
use anchor_lang::prelude::*;

use instructions::*;
use utils::*;

pub mod events;
pub mod instructions;
pub mod state;
pub mod utils;

// This is a second instance to test migration, only deployed with specific flag
#[cfg(feature = "dev")]
declare_id!("7ApLyZSzV9jHseZnSLmyHJjsbNWzd85DYx2qe8cSCLWt");

#[cfg(not(feature = "dev"))]
declare_id!("n6sR7Eg5LMg5SGorxK9q3ZePHs9e8gjoQ7TgUW2YCaG");

#[program]
pub mod folio {

    use super::*;

    /*
    Folio functions
    */
    #[allow(clippy::too_many_arguments)]
    pub fn init_folio(
        ctx: Context<InitFolio>,
        scaled_tvl_fee: u128,
        scaled_mint_fee: u128,
        auction_delay: u64,
        auction_length: u64,
        name: String,
        symbol: String,
        uri: String,
        mandate: String,
    ) -> Result<()> {
        init_folio::handler(
            ctx,
            scaled_tvl_fee,
            scaled_mint_fee,
            auction_delay,
            auction_length,
            name,
            symbol,
            uri,
            mandate,
        )
    }

    pub fn resize_folio(ctx: Context<ResizeFolio>, new_size: u64) -> Result<()> {
        resize_folio::handler(ctx, new_size)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn update_folio(
        ctx: Context<UpdateFolio>,
        scaled_tvl_fee: Option<u128>,
        scaled_mint_fee: Option<u128>,
        auction_delay: Option<u64>,
        auction_length: Option<u64>,
        fee_recipients_to_add: Vec<FeeRecipient>,
        fee_recipients_to_remove: Vec<Pubkey>,
        mandate: Option<String>,
    ) -> Result<()> {
        update_folio::handler(
            ctx,
            scaled_tvl_fee,
            scaled_mint_fee,
            auction_delay,
            auction_length,
            fee_recipients_to_add,
            fee_recipients_to_remove,
            mandate,
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
        raw_initial_shares: Option<u64>,
    ) -> Result<()> {
        add_to_basket::handler(ctx, amounts, raw_initial_shares)
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
    Migration functions
     */
    pub fn start_folio_migration<'info>(
        ctx: Context<'_, '_, 'info, 'info, StartFolioMigration<'info>>,
    ) -> Result<()> {
        start_folio_migration::handler(ctx)
    }

    pub fn migrate_folio_tokens<'info>(
        ctx: Context<'_, '_, 'info, 'info, MigrateFolioTokens<'info>>,
    ) -> Result<()> {
        migrate_folio_tokens::handler(ctx)
    }

    /*
    User functions
     */
    pub fn add_to_pending_basket<'info>(
        ctx: Context<'_, '_, 'info, 'info, AddToPendingBasket<'info>>,
        raw_amounts: Vec<u64>,
    ) -> Result<()> {
        add_to_pending_basket::handler(ctx, raw_amounts)
    }

    pub fn remove_from_pending_basket<'info>(
        ctx: Context<'_, '_, 'info, 'info, RemoveFromPendingBasket<'info>>,
        raw_amounts: Vec<u64>,
    ) -> Result<()> {
        remove_from_pending_basket::handler(ctx, raw_amounts)
    }

    pub fn mint_folio_token<'info>(
        ctx: Context<'_, '_, 'info, 'info, MintFolioToken<'info>>,
        raw_shares: u64,
    ) -> Result<()> {
        mint_folio_token::handler(ctx, raw_shares)
    }

    pub fn burn_folio_token<'info>(
        ctx: Context<'_, '_, 'info, 'info, BurnFolioToken<'info>>,
        raw_shares: u64,
    ) -> Result<()> {
        burn_folio_token::handler(ctx, raw_shares)
    }

    pub fn redeem_from_pending_basket<'info>(
        ctx: Context<'_, '_, 'info, 'info, RedeemFromPendingBasket<'info>>,
        raw_amounts: Vec<u64>,
    ) -> Result<()> {
        redeem_from_pending_basket::handler(ctx, raw_amounts)
    }

    pub fn close_user_pending_token_amount<'info>(
        ctx: Context<'_, '_, 'info, 'info, CloseUserPendingTokenAmount<'info>>,
    ) -> Result<()> {
        close_user_pending_token_amount::handler(ctx)
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

    /*
    Auction functions
     */
    pub fn approve_auction<'info>(
        ctx: Context<'_, '_, 'info, 'info, ApproveAuction<'info>>,
        auction_id: u64,
        sell_limit: BasketRange,
        buy_limit: BasketRange,
        prices: Prices,
        ttl: u64,
    ) -> Result<()> {
        approve_auction::handler(ctx, auction_id, sell_limit, buy_limit, prices, ttl)
    }

    pub fn open_auction<'info>(
        ctx: Context<'_, '_, 'info, 'info, OpenAuction<'info>>,
        scaled_sell_limit: u128,
        scaled_buy_limit: u128,
        scaled_start_price: u128,
        scaled_end_price: u128,
    ) -> Result<()> {
        open_auction::handler(
            ctx,
            scaled_sell_limit,
            scaled_buy_limit,
            scaled_start_price,
            scaled_end_price,
        )
    }

    pub fn close_auction<'info>(
        ctx: Context<'_, '_, 'info, 'info, CloseAuction<'info>>,
    ) -> Result<()> {
        close_auction::handler(ctx)
    }

    pub fn open_auction_permissionless<'info>(
        ctx: Context<'_, '_, 'info, 'info, OpenAuctionPermissionless<'info>>,
    ) -> Result<()> {
        open_auction_permissionless::handler(ctx)
    }

    pub fn bid<'info>(
        ctx: Context<'_, '_, 'info, 'info, Bid<'info>>,
        raw_sell_amount: u64,
        raw_max_buy_amount: u64,
        with_callback: bool,
        callback_data: Vec<u8>,
    ) -> Result<()> {
        bid::handler(
            ctx,
            raw_sell_amount,
            raw_max_buy_amount,
            with_callback,
            callback_data,
        )
    }

    /*
    Reward token functions
     */
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

    /*
    Dummy functions
     */
    pub fn idl_include_account<'info>(
        ctx: Context<'_, '_, 'info, 'info, IdlIncludeAccount<'info>>,
    ) -> Result<()> {
        dummy_instruction::idl_include_account(ctx)
    }
}
