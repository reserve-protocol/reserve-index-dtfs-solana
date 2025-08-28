//! Folio Program
//!
//! This program is used to
//!     - Create, update, and manage folios.
//!     - Accumulate and distribute fees.
//!     - Conduct auctions.
//!     - Buy into and redeem from folios.
//!     - Migrate between different folio versions.
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
#![allow(clippy::too_many_arguments)]
#![allow(unexpected_cfgs)]
#![allow(clippy::doc_overindented_list_items)]
#![allow(
    deprecated,
    reason = "Anchor internally calls AccountInfo::realloc (see PR #3803)"
)]
use anchor_lang::prelude::*;

use instructions::*;
use utils::*;

pub mod events;
pub mod instructions;
pub mod state;
pub mod utils;

// This is also in local tests used as second instance of folio program to test migration.
#[cfg(feature = "dev")]
declare_id!("n6sR7Eg5LMg5SGorxK9q3ZePHs9e8gjoQ7TgUW2YCaG");

#[cfg(not(feature = "dev"))]
declare_id!("DTF4yDGBkXJ25Ech1JVQpfwVb1vqYW4RJs5SuGNWdDev");

// This deprecation is in anchor-lang code and there is PR for this
// https://github.com/solana-foundation/anchor/pull/3803
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
            auction_length,
            name,
            symbol,
            uri,
            mandate,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn init_folio_2022(
        ctx: Context<InitFolio2022>,
        scaled_tvl_fee: u128,
        scaled_mint_fee: u128,
        auction_length: u64,
        name: String,
        symbol: String,
        uri: String,
        mandate: String,
    ) -> Result<()> {
        init_folio_2022::handler(
            ctx,
            scaled_tvl_fee,
            scaled_mint_fee,
            auction_length,
            name,
            symbol,
            uri,
            mandate,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn update_folio<'info>(
        ctx: Context<'_, '_, 'info, 'info, UpdateFolio<'info>>,
        scaled_tvl_fee: Option<u128>,
        index_for_fee_distribution: Option<u64>,
        scaled_mint_fee: Option<u128>,
        auction_length: Option<u64>,
        fee_recipients_to_add: Vec<FeeRecipient>,
        fee_recipients_to_remove: Vec<Pubkey>,
        mandate: Option<String>,
    ) -> Result<()> {
        update_folio::handler(
            ctx,
            scaled_tvl_fee,
            index_for_fee_distribution,
            scaled_mint_fee,
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
    ) -> Result<()> {
        remove_from_basket::handler(ctx)
    }

    pub fn kill_folio(ctx: Context<KillFolio>) -> Result<()> {
        kill_folio::handler(ctx)
    }

    /*
    Migration functions
     */
    pub fn start_folio_migration<'info>(
        ctx: Context<'_, '_, 'info, 'info, StartFolioMigration<'info>>,
        max_allowed_pending_fees: u128,
    ) -> Result<()> {
        start_folio_migration::handler(ctx, max_allowed_pending_fees)
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
        min_raw_shares: Option<u64>,
    ) -> Result<()> {
        mint_folio_token::handler(ctx, raw_shares, min_raw_shares)
    }

    pub fn burn_folio_token<'info>(
        ctx: Context<'_, '_, 'info, 'info, BurnFolioToken<'info>>,
        raw_shares: u64,
        minimum_out_for_token_amounts: Vec<MinimumOutForTokenAmount>,
    ) -> Result<()> {
        burn_folio_token::handler(ctx, raw_shares, minimum_out_for_token_amounts)
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

    pub fn transfer_from_user_pending_basket_ata<'info>(
        ctx: Context<'_, '_, 'info, 'info, TransferFromUserPendingBasketAta<'info>>,
    ) -> Result<()> {
        transfer_from_user_pending_basket_ata::handler(ctx)
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
    Rebalancing and Auction functions
    */
    pub fn start_rebalance<'info>(
        ctx: Context<'_, '_, 'info, 'info, StartRebalance<'info>>,
        auction_launcher_window: u64,
        ttl: u64,
        prices_and_limits: Vec<RebalancePriceAndLimits>,
        all_rebalance_details_added: bool,
    ) -> Result<()> {
        start_rebalance::handler(
            ctx,
            auction_launcher_window,
            ttl,
            prices_and_limits,
            all_rebalance_details_added,
        )
    }

    pub fn add_rebalance_details<'info>(
        ctx: Context<'_, '_, 'info, 'info, AddRebalanceDetails<'info>>,
        prices_and_limits: Vec<RebalancePriceAndLimits>,
        all_rebalance_details_added: bool,
    ) -> Result<()> {
        add_rebalance_details::handler(ctx, prices_and_limits, all_rebalance_details_added)
    }

    pub fn open_auction<'info>(
        ctx: Context<'_, '_, 'info, 'info, OpenAuction<'info>>,
        token_1: Pubkey,
        token_2: Pubkey,
        scaled_sell_limit: u128,
        scaled_buy_limit: u128,
        scaled_start_price: u128,
        scaled_end_price: u128,
    ) -> Result<()> {
        open_auction::handler(
            ctx,
            token_1,
            token_2,
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
        token_1: Pubkey,
        token_2: Pubkey,
    ) -> Result<()> {
        open_auction_permissionless::handler(ctx, token_1, token_2)
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
    Development functions, used to show implementation for future folio program versions.
     */
    #[allow(unused_variables)]
    pub fn update_basket_in_new_folio_program<'info>(
        ctx: Context<'_, '_, 'info, 'info, UpdateBasketInNewFolioProgram<'info>>,
    ) -> Result<()> {
        #[cfg(feature = "test")]
        {
            update_basket_in_new_folio_program::handler(ctx)
        }
        #[cfg(not(feature = "test"))]
        {
            Ok(())
        }
    }

    /*
    Development functions, used to show implementation for future folio program versions.
     */
    #[allow(unused_variables)]
    pub fn create_folio_from_old_program<'info>(
        ctx: Context<'_, '_, 'info, 'info, CreateFolioFromOldProgram<'info>>,
    ) -> Result<()> {
        #[cfg(feature = "test")]
        {
            create_folio_from_old_program::handler(ctx)
        }
        #[cfg(not(feature = "test"))]
        {
            Ok(())
        }
    }
}
