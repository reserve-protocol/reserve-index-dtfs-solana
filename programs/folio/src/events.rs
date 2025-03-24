use anchor_lang::prelude::*;

/// Event emitted when a folio is created.
#[event]
pub struct FolioCreated {
    pub folio_token_mint: Pubkey,
}

/// Event emitted when a folio is killed.
#[event]
pub struct FolioKilled {}

/// Event emitted when a basket token is added.
///
/// # Arguments
/// * `token` - The token mint that was added to the basket.
#[event]
pub struct BasketTokenAdded {
    pub token: Pubkey,
}

/// Event emitted when a basket token is removed.
///
/// # Arguments
/// * `token` - The token mint that was removed from the basket.
#[event]
pub struct BasketTokenRemoved {
    pub token: Pubkey,
}

/// Event emitted when a TVL fee is set.
///
/// # Arguments
/// * `new_fee` - The new TVL fee.
#[event]
pub struct TVLFeeSet {
    /// Scaled in D18
    pub new_fee: u128,
}

/// Event emitted when a mint fee is set.
///
/// # Arguments
/// * `new_fee` - The new mint fee.
#[event]
pub struct MintFeeSet {
    /// Scaled in D18
    pub new_fee: u128,
}

/// Event emitted when a fee recipient is set.
///
/// # Arguments
/// * `recipient` - The recipient of the fee.
/// * `portion` - The portion of the fee to be paid to the recipient, scaled in D18.
#[event]
pub struct FeeRecipientSet {
    pub recipient: Pubkey,

    /// Scaled in D18
    pub portion: u128,
}

/// Event emitted when a TVL fee is paid.
///
/// # Arguments
/// * `recipient` - The recipient of the fee.
/// * `amount` - The amount of the fee to be paid, scaled in D9.
#[event]
pub struct TVLFeePaid {
    pub recipient: Pubkey,

    /// Scaled in D9
    pub amount: u64,
}

/// Event emitted when a protocol fee is paid.
///
/// # Arguments
/// * `recipient` - The recipient of the fee.
/// * `amount` - The amount of the fee to be paid, scaled in D9.
#[event]
pub struct ProtocolFeePaid {
    pub recipient: Pubkey,

    /// Scaled in D9
    pub amount: u64,
}

/// Event emitted when an auction is opened.
///
/// # Arguments
/// * `auction_id` - The id of the auction.
/// * `auction_run_index` - In case of auction re-run it will be the index of run.
/// * `start_price` - The start price of the auction, scaled in D18.
/// * `end_price` - The end price of the auction, scaled in D18.
/// * `start` - The start time of the auction, scaled in seconds.
/// * `end` - The end time of the auction, scaled in seconds.
#[event]
pub struct AuctionOpened {
    pub auction_id: u64,

    pub auction_run_index: u8,

    /// Scaled in D18
    pub start_price: u128,

    /// Scaled in D18
    pub end_price: u128,

    /// Scaled in seconds
    pub start: u64,

    /// Scaled in seconds
    pub end: u64,
}

/// Event emitted when a dust limit is set for a token.
///
/// # Arguments
/// * `token` - The token mint that the dust limit was set for.
/// * `folio` - The folio that the dust limit was set for.
/// * `dust_limit` - The dust limit for the token
#[event]
pub struct DustLimitSetForToken {
    pub token: Pubkey,

    pub folio: Pubkey,

    pub dust_limit: u128,
}

/// Event emitted when an auction is approved.
///
/// # Arguments
/// * `auction_id` - The id of the auction.
/// * `from` - The from address.
/// * `to` - The to address.
/// * `amount` - The amount of the auction, scaled in D9.
/// * `start_price` - The start price of the auction, scaled in D18.
#[event]
pub struct AuctionApproved {
    pub auction_id: u64,
    pub from: Pubkey,
    pub to: Pubkey,

    /// Scaled in D9
    pub amount: u64,

    /// Scaled in D18
    pub start_price: u128,
}

/// Event emitted when an auction is closed.
///
/// # Arguments
/// * `auction_id` - The id of the auction.
#[event]
pub struct AuctionClosed {
    pub auction_id: u64,
}

/// Event emitted when an auction bid is made.
///
/// # Arguments
/// * `auction_id` - The id of the auction.
/// * `sell_amount` - The amount of the sell, scaled in D9.
/// * `bought_amount` - The amount of the bought, scaled in D9.
#[event]
pub struct AuctionBid {
    pub auction_id: u64,

    /// Scaled in D9
    pub sell_amount: u64,

    /// Scaled in D9
    pub bought_amount: u64,
}

/// Event emitted when an auction delay is set.
///
/// # Arguments
/// * `new_auction_delay` - The new auction delay, scaled in seconds.
#[event]
pub struct AuctionDelaySet {
    /// Scaled in seconds
    pub new_auction_delay: u64,
}

/// Event emitted when an auction length is set.
///
/// # Arguments
/// * `new_auction_length` - The new auction length, scaled in seconds.
#[event]
pub struct AuctionLengthSet {
    /// Scaled in seconds    
    pub new_auction_length: u64,
}

/// Event emitted when a mandate is set.
///
/// # Arguments
/// * `new_mandate` - The new mandate.
#[event]
pub struct MandateSet {
    pub new_mandate: Pubkey,
}
