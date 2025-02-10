use anchor_lang::prelude::*;

#[derive(
    AnchorSerialize, AnchorDeserialize, Default, Clone, Copy, PartialEq, Eq, Debug, InitSpace,
)]
pub enum AuctionStatus {
    #[default]
    // start == 0 && end == 0
    APPROVED = 0,
    // block.timestamp >= start && block.timestamp <= end
    Open = 1,
    // block.timestamp > end
    Closed = 2,
}
