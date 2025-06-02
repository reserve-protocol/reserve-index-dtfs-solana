use crate::utils::{
    structs::FeeRecipient, FixedSizeString, FolioTokenBasket, PricesInAuction, RebalanceDetails,
    UserTokenBasket,
};
use anchor_lang::prelude::*;
use shared::constants::MAX_FEE_RECIPIENTS;

/// Actor is used to track permissions of different addresses on a folio. This is done via
/// the role property and a bitwise operation.
///
/// An actor can have multiple roles.
///
/// PDA Seeds ["actor", authority pubkey, folio pubkey]
#[account]
#[derive(Default, InitSpace)]
pub struct Actor {
    pub bump: u8,

    /// The authority of the actor, which is the address that has the related role.
    pub authority: Pubkey,

    /// The folio that the actor is related to.
    pub folio: Pubkey,

    /// The roles that the actor has.
    pub roles: u8,
}

impl Actor {
    pub const SIZE: usize = 8 + Actor::INIT_SPACE;
}

/// Folio is the main account that holds the state of a folio.
///
/// zero_copy
/// PDA Seeds ["folio", folio token pubkey]
///
/// Note: This is 16 byte aligned due to the u128 fields.
/// In order to deserialize you must use `bytemuck::try_pod_read_unaligned(&mut data[8..])`
/// where the 8 byte discriminant is skipped.
#[account(zero_copy)]
#[derive(InitSpace, Default)]
#[repr(C)]
pub struct Folio {
    pub bump: u8,

    pub status: u8,

    /// Padding for zero copy alignment
    pub _padding: [u8; 14],

    /// The mint of the folio token
    pub folio_token_mint: Pubkey,

    /// Demurrage fee on AUM scaled in D18
    pub tvl_fee: u128,

    /// Fee for minting shares of the folio token, scaled in D18
    pub mint_fee: u128,

    /// Shares pending to be distributed ONLY to the DAO, scaled in D9
    pub dao_pending_fee_shares: u128,

    /// Shares pending to be distributed ONLY to the fee recipients, scaled in D9
    pub fee_recipients_pending_fee_shares: u128,

    /// Duration of an auction, scaled in seconds
    pub auction_length: u64,

    /// Last time the folio was poked, scaled in seconds
    pub last_poke: u64,

    /// Describes mission/brand of the Folio (max size 128 bytes)
    pub mandate: FixedSizeString,

    /// Amount of fees to be minted to the fee recipients, scaled in D9, we need this since the fee
    /// distribution is done in multiple steps, so we need to keep track of the amount to be minted
    /// for when we calculate the total supply.
    pub fee_recipients_pending_fee_shares_to_be_minted: u128,
}

impl Folio {
    pub const SIZE: usize = 8 + Folio::INIT_SPACE;
}

/// FeeRecipients is used to track the fee recipients of a folio.
///
/// zero_copy
/// PDA Seeds ["fee_recipients", folio pubkey]
#[account(zero_copy)]
#[derive(InitSpace)]
pub struct FeeRecipients {
    pub bump: u8,

    /// Padding for zero copy alignment
    pub _padding: [u8; 7],

    /// Index of the fee distribution, will increase for every distribute fee instruction called.
    pub distribution_index: u64,

    pub folio: Pubkey,

    /// Max 64 fee recipients, default pubkey means not set
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

/// FeeDistribution is used to track the fee distribution of a folio to the fee recipients.
/// One of those account is created for each fee distribution instruction and is used to track the
/// fee distribution state to see which fee recipients have received their share of the fees.
///
/// zero_copy
/// PDA Seeds ["fee_distribution", folio pubkey, index]
#[account(zero_copy)]
#[derive(InitSpace)]
pub struct FeeDistribution {
    pub bump: u8,

    /// Padding for zero copy alignment
    pub _padding: [u8; 7],

    /// Index of the fee distribution, represents one distribute fee instruction call
    pub index: u64,

    pub folio: Pubkey,

    /// Person who cranked the distribute fee instruction, so that we can reimburse rent on account closure.
    pub cranker: Pubkey,

    /// Amount of fees to distribute, scaled in D9
    pub amount_to_distribute: u128,

    /// Represents the fee recipient account state at the time of the distribute fee instruction call.
    /// Default pubkey means the fee was distributed to that recipient.
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

/// This is used to track the "frozen" token amounts in the folio, like when a user is in the process of minting new shares,
/// so that those tokens aren't taken into account for different calculations.
///
/// It also will represent which tokens are currently part of the basket of the folio.
///
/// Max of 16 tokens because of solana's restrictions on transaction size.
///
/// zero_copy
/// PDA Seeds ["folio_basket", folio pubkey]
#[account(zero_copy)]
#[derive(InitSpace, Default)]
pub struct FolioBasket {
    pub bump: u8,

    /// Padding for zero copy alignment
    pub _padding: [u8; 7],

    /// Folio's pubkey
    pub folio: Pubkey,

    /// Represents the amount frozen for minting as well as the amount frozen for redeeming PER token in the basket.
    /// Default pubkey means not set.
    pub basket: FolioTokenBasket,
}

impl FolioBasket {
    pub const SIZE: usize = 8 + FolioBasket::INIT_SPACE;
}

/// This is use to track the user's "pending" token amounts, for operations like minting or redeeming,
/// because those operations are done in multiple steps. It directly relates to token_amounts in FolioBasket.
///
/// Max of 110 tokens because of solana's restrictions on transaction size.
///     Higher than the 100 of FolioBasket, because it could include removed coins from the FolioBasket that
///     still need to be redeemed.
///
/// zero_copy
/// PDA Seeds ["user_pending_basket", folio pubkey, wallet pubkey]
#[account(zero_copy)]
#[derive(InitSpace, Default)]
pub struct UserPendingBasket {
    pub bump: u8,

    /// Padding for zero copy alignment
    pub _padding: [u8; 7],

    /// User's wallet pubkey
    pub owner: Pubkey,

    /// Folio's pubkey
    pub folio: Pubkey,

    /// Represents the amounts for minting as well as the amount for redeeming PER token in the user's pending basket.
    /// Default pubkey means not set.
    pub basket: UserTokenBasket,
}

impl UserPendingBasket {
    pub const SIZE: usize = 8 + UserPendingBasket::INIT_SPACE;
}

/// This is used to track a rebalance's state. There is only 1 rebalance for a folio.
/// The same account is updated if a new rebalance is started, and we close
///
/// Rebalancing
///   Rebalance starts -> OPEN -> CLOSED
///   - Rebalance starts when a new rebalance is started
///   - Rebalance is open when the rebalance is active
///   - Rebalance is closed when the rebalance is completed
///
/// zero_copy
/// PDA Seeds ["rebalance", folio pubkey]
#[account(zero_copy)]
#[derive(Default, InitSpace)]
#[repr(C)]
pub struct Rebalance {
    pub bump: u8,

    /// Whether all rebalance details have been added
    /// Because of the transaction size limits, we allow adding rebalance details in multiple transactions.
    /// In the last transaction, user need to pass `all_rebalance_details_added` to close the rebalance.
    pub all_rebalance_details_added: u8,

    /// Padding for zero copy alignment
    pub _padding: [u8; 6],

    pub folio: Pubkey,

    /// Current auction id, starts at 0
    /// Resets to 0 when a new rebalance is started
    pub current_auction_id: u64,

    pub nonce: u64,

    pub started_at: u64,

    pub restricted_until: u64,

    pub available_until: u64,

    pub details: RebalanceDetails,
}

impl Rebalance {
    pub const SIZE: usize = 8 + Rebalance::INIT_SPACE;
}

/// This is used to track an auction's state.
///
/// Rebalancing
///   APPROVED -> OPEN -> CLOSED
///   - Approved auctions have a delay before they can be opened, that AUCTION_LAUNCHER can bypass
///   - Multiple auctions can be open at once, though a token cannot be bought and sold simultaneously
///   - Multiple bids can be executed against the same auction
///   - All auctions are dutch auctions with the same price curve, but it's possible to pass startPrice = endPrice
///
/// zero_copy
/// PDA Seeds ["auction", folio pubkey, rebalance nonce, auction id]
#[account(zero_copy)]
#[derive(Default, InitSpace)]
#[repr(C)]
pub struct Auction {
    pub bump: u8,

    /// Padding for zero copy alignment
    pub _padding: [u8; 7],

    /// Auction id
    pub id: u64,

    /// Rebalance nonce
    pub nonce: u64,

    /// Padding for zero copy alignment
    pub _padding2: [u8; 8],

    pub folio: Pubkey,

    /// Sell token mint
    pub sell_mint: Pubkey,

    /// Buy token mint
    pub buy_mint: Pubkey,

    /// D9{sellToken/share} min ratio of sell token in the basket, inclusive
    pub sell_limit: u128,

    /// D9{buyToken/share} min ratio of buy token in the basket, exclusive
    pub buy_limit: u128,

    /// Scaled in seconds, inclusive
    /// If zero, the auction run was never ran.
    pub start: u64,

    /// Scaled in seconds, inclusive
    pub end: u64,

    /// D9{buyToken/sellToken}
    pub prices: PricesInAuction,
}

impl Auction {
    pub const SIZE: usize = 8 + Auction::INIT_SPACE;
}

// For a rebalance, this account keeps track of the end time of the auction for the token pair
// Token1 => min(sellToken, buyToken)
// Token2 => max(sellToken, buyToken)
// PDA Seeds ["auction_ends", rebalance nonce, token mint 1, token mint 2]
#[account()]
#[derive(Default, InitSpace)]
pub struct AuctionEnds {
    pub bump: u8,
    pub rebalance_nonce: u64,
    // Token 1 < Token 2
    pub token_mint_1: Pubkey,
    pub token_mint_2: Pubkey,
    pub end_time: u64,
}

impl AuctionEnds {
    pub const SIZE: usize = 8 + AuctionEnds::INIT_SPACE;
}
