use anchor_lang::prelude::*;
use shared::constants::MAX_REWARD_TOKENS;

/// This is used to track the reward tokens.
///
/// Realm will be able to add reward tokens it wants to track so that
/// it can be distributed to the users participating in the governance of the Realm.
///
/// zero_copy
/// PDA Seeds ["reward_tokens", realm pubkey]
#[account(zero_copy)]
#[derive(InitSpace)]
#[repr(C)]
pub struct RewardTokens {
    pub bump: u8,

    /// Padding for zero copy alignment
    pub _padding: [u8; 15],

    /// Realm's pubkey
    pub realm: Pubkey,

    /// Admin of the rewards, will be a governance account (PDA) of the realm
    pub rewards_admin: Pubkey,

    /// Scaled in D18
    pub reward_ratio: u128,

    // List of current tracked reward tokens
    // Default pubkey means not set.
    /// Max of 4 reward tokens.
    pub reward_tokens: [Pubkey; MAX_REWARD_TOKENS],
}

impl RewardTokens {
    pub const SIZE: usize = 8 + RewardTokens::INIT_SPACE;
}

/// This is used to track the reward info of a specific reward token.
///
/// PDA Seeds ["reward_info", realm pubkey, reward token pubkey]
#[account]
#[derive(Default, InitSpace)]
pub struct RewardInfo {
    pub bump: u8,

    /// Realm's pubkey
    pub realm: Pubkey,

    /// Reward token pubkey
    pub reward_token: Pubkey,

    /// Scaled in seconds
    pub payout_last_paid: u64,

    /// D18+decimals{reward/share}, scaled in D18
    pub reward_index: u128,

    /// Scaled in D18
    pub balance_accounted: u128,

    /// Scaled in D18
    pub balance_last_known: u128,

    /// Scaled in D18 to track dust (represents reward tokens claimed - dust)
    pub total_claimed: u128,

    /// If the token is disallowed, this will be true
    pub is_disallowed: bool,
}

impl RewardInfo {
    pub const SIZE: usize = 8 + RewardInfo::INIT_SPACE;
}

/// This is used to track the reward info of a specific reward token of a user.
///
/// PDA Seeds ["user_reward_info", realm pubkey, reward token pubkey, user pubkey]
#[doc = "Have to add it to a dummy instruction so that Anchor picks it up for IDL generation."]
#[account]
#[derive(Default, InitSpace)]
pub struct UserRewardInfo {
    pub bump: u8,

    /// Realm's pubkey
    pub realm: Pubkey,

    /// Reward token pubkey
    pub reward_token: Pubkey,

    /// D18+decimals{reward/share}, scaled in D18
    pub last_reward_index: u128,

    /// Scaled in D18
    pub accrued_rewards: u128,
}

impl UserRewardInfo {
    pub const SIZE: usize = 8 + UserRewardInfo::INIT_SPACE;
}
