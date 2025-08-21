//! Reward Program
//!
//! This program is used to
//!     - Create, update, and manage rewards.
//!     - Reward token distribution.
//!
//! # Instructions
//!
//! * `init_or_set_reward_ratio` - Initialize or set the reward ratio.
//! * `add_reward_token` - Add a tracked reward token.
//! * `remove_reward_token` - Remove a tracked reward token.
//! * `claim_rewards` - Claim rewards from a token, which means transferring the rewards accrued by a user to the user.
//! * `accrue_rewards` - Accrue rewards to a token, meaning updating accrued rewards.
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

declare_id!("7GiMvNDHVY8PXWQLHjSf1REGKpiDsVzRr4p7Y3xGbSuf");

#[program]
pub mod rewards {

    use super::*;

    pub fn set_rewards_admin<'info>(
        ctx: Context<'_, '_, 'info, 'info, SetRewardsAdmin<'info>>,
    ) -> Result<()> {
        set_rewards_admin::handler(ctx)
    }

    pub fn init_or_set_reward_ratio<'info>(
        ctx: Context<'_, '_, 'info, 'info, InitOrSetRewardRatio<'info>>,
        reward_period: u64,
    ) -> Result<()> {
        init_or_set_reward_ratio::handler(ctx, reward_period)
    }

    pub fn add_reward_token<'info>(
        ctx: Context<'_, '_, 'info, 'info, AddRewardToken<'info>>,
    ) -> Result<()> {
        add_reward_token::handler(ctx)
    }

    pub fn remove_reward_token<'info>(
        ctx: Context<'_, '_, 'info, 'info, RemoveRewardToken<'info>>,
    ) -> Result<()> {
        remove_reward_token::handler(ctx)
    }

    pub fn claim_rewards<'info>(
        ctx: Context<'_, '_, 'info, 'info, ClaimRewards<'info>>,
    ) -> Result<()> {
        claim_rewards::handler(ctx)
    }

    pub fn accrue_rewards<'info>(
        ctx: Context<'_, '_, 'info, 'info, AccrueRewards<'info>>,
    ) -> Result<()> {
        accrue_rewards::handler(ctx)
    }

    /*
    Dummy functions
     */
    pub fn idl_include_account<'info>(
        ctx: Context<'_, '_, 'info, 'info, IdlIncludeAccount<'info>>,
    ) -> Result<()> {
        dummy_instruction::idl_include_account(ctx)
    }
}
