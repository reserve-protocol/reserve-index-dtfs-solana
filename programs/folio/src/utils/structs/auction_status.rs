use anchor_lang::prelude::*;

/// Status of the auction. It is not stored anywhere in an account.
/// It's derived from the current timestamp and the start and end times of the auction.
#[derive(
    AnchorSerialize, AnchorDeserialize, Default, Clone, Copy, PartialEq, Eq, Debug, InitSpace,
)]
pub enum AuctionStatus {
    #[default]
    /// start == 0 && end == 0
    APPROVED = 0,
    /// Clock.unix_timestamp >= start && Clock.unix_timestamp <= end
    Open = 1,
    /// Clock.unix_timestamp > end
    Closed = 2,
}
