use crate::utils::{
    structs::{AuctionEnd, BasketRange, FeeRecipient, TokenAmount},
    FixedSizeString, Prices,
};
use anchor_lang::prelude::*;
use shared::constants::{
    MAX_CONCURRENT_AUCTIONS, MAX_FEE_RECIPIENTS, MAX_FOLIO_TOKEN_AMOUNTS, MAX_REWARD_TOKENS,
    MAX_USER_PENDING_BASKET_TOKEN_AMOUNTS,
};

/// PDA Seeds ["actor", auth pubkey, folio pubkey]
#[account]
#[derive(Default, InitSpace)]
pub struct Actor {
    pub bump: u8,

    pub authority: Pubkey,
    pub folio: Pubkey,

    // Will use bitwise operations to check for roles
    pub roles: u8,
}

impl Actor {
    pub const SIZE: usize = 8 + Actor::INIT_SPACE;
}

/// PDA Seeds ["folio", folio token pubkey]
#[account(zero_copy)]
#[derive(InitSpace, Default)]
#[repr(C)]
pub struct Folio {
    pub bump: u8,

    pub status: u8,

    pub _padding: [u8; 14],

    // The mint of the folio token (Circulating supply is stored in the token mint automatically)
    pub folio_token_mint: Pubkey,

    /*
    Fee related properties
     */
    pub tvl_fee: u128,
    pub mint_fee: u128,

    pub dao_pending_fee_shares: u128,
    pub fee_recipients_pending_fee_shares: u128,

    /*
    Auction related properties
     */
    pub auction_delay: u64,
    pub auction_length: u64,

    pub current_auction_id: u64,

    pub last_poke: i64,

    pub sell_ends: [AuctionEnd; MAX_CONCURRENT_AUCTIONS],
    pub buy_ends: [AuctionEnd; MAX_CONCURRENT_AUCTIONS],

    // Fixed size mandate
    pub mandate: FixedSizeString,
}

impl Folio {
    pub const SIZE: usize = 8 + Folio::INIT_SPACE;
}

/// PDA Seeds ["fee_recipients", folio pubkey]
#[account(zero_copy)]
#[derive(InitSpace)]
pub struct FeeRecipients {
    pub bump: u8,
    pub _padding: [u8; 7],

    pub distribution_index: u64,

    pub folio: Pubkey,

    // Max 64 fee recipients, default pubkey means not set
    pub fee_recipients: [FeeRecipient; MAX_FEE_RECIPIENTS],
}

impl FeeRecipients {
    pub const SIZE: usize = 8 + FeeRecipients::INIT_SPACE;
}

impl Default for FeeRecipients {
    fn default() -> Self {
        Self {
            bump: 0,
            _padding: [0; 7],
            distribution_index: 0,
            folio: Pubkey::default(),
            fee_recipients: [FeeRecipient::default(); MAX_FEE_RECIPIENTS],
        }
    }
}

/// PDA Seeds ["fee_distribution", folio pubkey, index]
#[account(zero_copy)]
#[derive(InitSpace)]
pub struct FeeDistribution {
    pub bump: u8,
    pub _padding: [u8; 7],

    pub index: u64,

    pub folio: Pubkey,

    // Person who cranked the distribute, tracking to reimburse rent
    pub cranker: Pubkey,

    pub amount_to_distribute: u128,

    pub fee_recipients_state: [FeeRecipient; MAX_FEE_RECIPIENTS],
}

impl FeeDistribution {
    pub const SIZE: usize = 8 + FeeDistribution::INIT_SPACE;
}

impl Default for FeeDistribution {
    fn default() -> Self {
        Self {
            bump: 0,
            _padding: [0; 7],
            index: 0,
            folio: Pubkey::default(),
            cranker: Pubkey::default(),
            amount_to_distribute: 0,
            fee_recipients_state: [FeeRecipient::default(); MAX_FEE_RECIPIENTS],
        }
    }
}

/*
This is used to track the "frozen" token amounts in the folio, like when a user is minting, so that
those tokens aren't taken into account. It also will represent which tokens are in the folio (authorized tokens).

Max of 16 tokens because of solana's restrictions
*/

/// PDA Seeds ["folio_basket", folio] for the folio's pending token amounts
#[account(zero_copy)]
#[derive(InitSpace)]
pub struct FolioBasket {
    pub bump: u8,

    pub _padding: [u8; 7],

    /// Folio's pubkey
    pub folio: Pubkey,

    // Default pubkey means not set
    pub token_amounts: [TokenAmount; MAX_FOLIO_TOKEN_AMOUNTS],
}

impl FolioBasket {
    pub const SIZE: usize = 8 + FolioBasket::INIT_SPACE;
}

impl Default for FolioBasket {
    fn default() -> Self {
        Self {
            bump: 0,
            _padding: [0; 7],
            folio: Pubkey::default(),
            token_amounts: [TokenAmount::default(); MAX_FOLIO_TOKEN_AMOUNTS],
        }
    }
}

/*
This is use to track the current user's "pending" token amounts, like when he's minting
or burning and needs to do it in multiple steps.
*/

/// PDA Seeds ["user_pending_basket", folio, wallet] for the wallet's pending token amounts
#[account(zero_copy)]
#[derive(InitSpace)]
pub struct UserPendingBasket {
    pub bump: u8,

    pub _padding: [u8; 7],

    /// User's wallet pubkey or folio pubkey
    pub owner: Pubkey,

    /// Folio's pubkey
    pub folio: Pubkey,

    // Default pubkey means not set
    pub token_amounts: [TokenAmount; MAX_USER_PENDING_BASKET_TOKEN_AMOUNTS],
}

impl UserPendingBasket {
    pub const SIZE: usize = 8 + UserPendingBasket::INIT_SPACE;
}

impl Default for UserPendingBasket {
    fn default() -> Self {
        Self {
            bump: 0,
            _padding: [0; 7],
            owner: Pubkey::default(),
            folio: Pubkey::default(),
            token_amounts: [TokenAmount::default(); MAX_USER_PENDING_BASKET_TOKEN_AMOUNTS],
        }
    }
}

/// PDA Seeds ["auction", folio pubkey, auction id]
#[account(zero_copy)]
#[derive(Default, InitSpace)]
#[repr(C)]
pub struct Auction {
    pub bump: u8,
    pub _padding: [u8; 7],

    pub id: u64,

    pub available_at: u64,
    pub launch_timeout: u64,
    pub start: u64,
    pub end: u64,
    pub k: u128,

    pub folio: Pubkey,
    pub sell: Pubkey,
    pub buy: Pubkey,

    pub sell_limit: BasketRange,
    pub buy_limit: BasketRange,
    pub prices: Prices,
}

impl Auction {
    pub const SIZE: usize = 8 + Auction::INIT_SPACE;
}

/// PDA Seeds ["folio_reward_tokens", folio]
#[account(zero_copy)]
#[derive(InitSpace)]
#[repr(C)]
pub struct FolioRewardTokens {
    pub bump: u8,

    pub _padding: [u8; 15],

    /// Folio's pubkey
    pub folio: Pubkey,

    pub reward_ratio: u128,

    // List of current reward tokens
    pub reward_tokens: [Pubkey; MAX_REWARD_TOKENS],

    /// Disallowed token
    pub disallowed_token: [Pubkey; MAX_REWARD_TOKENS],
}

impl FolioRewardTokens {
    pub const SIZE: usize = 8 + FolioRewardTokens::INIT_SPACE;
}

/// PDA Seeds ["reward_info", folio, folio_reward_token]
#[account]
#[derive(Default, InitSpace)]
pub struct RewardInfo {
    pub bump: u8,

    /// Folio's pubkey
    pub folio: Pubkey,

    pub folio_reward_token: Pubkey,

    pub payout_last_paid: u64,

    pub reward_index: u128,

    pub balance_accounted: u128,
    pub balance_last_known: u128,

    pub total_claimed: u128,
}

impl RewardInfo {
    pub const SIZE: usize = 8 + RewardInfo::INIT_SPACE;
}

/// PDA Seeds ["user_reward_info", folio, folio_reward_token, user]
#[doc = "Have to add it to a dummy instruction so that Anchor picks it up for IDL generation."]
#[account]
#[derive(Default, InitSpace)]
pub struct UserRewardInfo {
    pub bump: u8,

    /// Folio's pubkey
    pub folio: Pubkey,

    pub folio_reward_token: Pubkey,

    pub last_reward_index: u128,

    pub accrued_rewards: u128,
}

impl UserRewardInfo {
    pub const SIZE: usize = 8 + UserRewardInfo::INIT_SPACE;
}
