use anchor_lang::prelude::*;

/// Event emitted when a reward token is added.
///
/// # Arguments
/// * `reward_token` - The reward token mint.
#[event]
pub struct RewardTokenAdded {
    pub reward_token: Pubkey,
}

/// Event emitted when a reward ratio is set.
///
/// # Arguments
/// * `reward_ratio` - The reward ratio, scaled in D18.
/// * `reward_half_life` - The reward half life, scaled in seconds.
#[event]
pub struct RewardRatioSet {
    /// Scaled in D18
    pub reward_ratio: u128,

    /// Scaled in seconds
    pub reward_half_life: u64,
}

/// Event emitted when a reward token is removed.
///
/// # Arguments
/// * `reward_token` - The reward token mint.
#[event]
pub struct RewardTokenRemoved {
    pub reward_token: Pubkey,
}
