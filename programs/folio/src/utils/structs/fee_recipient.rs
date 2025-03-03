use anchor_lang::prelude::*;
use bytemuck::{Pod, Zeroable};

/// A fee recipient for the Folio.
#[derive(
    AnchorSerialize,
    AnchorDeserialize,
    Clone,
    Copy,
    Default,
    InitSpace,
    Zeroable,
    Pod,
    PartialEq,
    Debug,
)]
#[repr(C)]
pub struct FeeRecipient {
    /// The recipient of the fee.
    pub recipient: Pubkey,

    /// The portion of the fee to be sent to the recipient, scaled in D18.
    pub portion: u128,
}
