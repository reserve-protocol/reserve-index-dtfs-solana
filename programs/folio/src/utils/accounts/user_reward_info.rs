use crate::state::{RewardInfo, UserRewardInfo};
use anchor_lang::prelude::*;
use shared::check_condition;
use shared::constants::SCALAR_U128;
use shared::errors::ErrorCode;
use shared::util::math_util::{RoundingMode, SafeArithmetic};

impl UserRewardInfo {
    pub fn process_init_if_needed(
        account_user_reward_info: &mut Account<UserRewardInfo>,
        context_bump: u8,
        folio: &Pubkey,
        reward_token: &Pubkey,
    ) -> Result<()> {
        if account_user_reward_info.bump != 0 {
            check_condition!(account_user_reward_info.bump == context_bump, InvalidBump);
        } else {
            // Not initialized yet
            account_user_reward_info.bump = context_bump;
            account_user_reward_info.folio = *folio;
            account_user_reward_info.folio_reward_token = *reward_token;
            account_user_reward_info.last_reward_index = 0;
            account_user_reward_info.accrued_rewards = 0;
        }

        Ok(())
    }

    pub fn accrue_rewards(
        &mut self,
        reward_info: &Account<RewardInfo>,
        user_balance: u64,
        mint_decimals: u64,
    ) -> Result<()> {
        let (delta_result, overflow) = reward_info
            .reward_index
            .overflowing_sub(self.last_reward_index);

        if overflow {
            // TODO negative, should we do something?
            return Ok(());
        } else if delta_result != 0 {
            let supplier_delta = <u64 as SafeArithmetic>::mul_div_precision_from_u128(
                user_balance as u128,
                delta_result as u128,
                mint_decimals as u128,
                RoundingMode::Floor,
            )
            .checked_div(SCALAR_U128)
            .unwrap();

            self.accrued_rewards = self
                .accrued_rewards
                .checked_add(supplier_delta as u64)
                .unwrap();

            self.last_reward_index = reward_info.reward_index;
        };

        Ok(())
    }
}
