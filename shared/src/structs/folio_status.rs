use anchor_lang::prelude::*;

#[derive(
    AnchorSerialize, AnchorDeserialize, Default, Clone, Copy, PartialEq, Eq, Debug, InitSpace,
)]
pub enum FolioStatus {
    #[default]
    Initializing = 0,
    Initialized = 1,
}
