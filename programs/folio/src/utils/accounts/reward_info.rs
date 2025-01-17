use crate::state::RewardInfo;
use anchor_lang::prelude::*;
use shared::check_condition;
use shared::constants::{SCALAR, SCALAR_U128};
use shared::errors::ErrorCode;
use shared::util::math_util::{RoundingMode, SafeArithmetic};

impl RewardInfo {
    pub fn process_init_if_needed(
        account_reward_info: &mut Account<RewardInfo>,
        context_bump: u8,
        folio: &Pubkey,
        reward_token: &Pubkey,
        last_known_balance: u64,
    ) -> Result<()> {
        if account_reward_info.bump != 0 {
            check_condition!(account_reward_info.bump == context_bump, InvalidBump);
        } else {
            // Not initialized yet
            account_reward_info.bump = context_bump;
            account_reward_info.folio = *folio;
            account_reward_info.folio_reward_token = *reward_token;
            account_reward_info.payout_last_paid = Clock::get()?.unix_timestamp as u64;
            account_reward_info.reward_index = 0;
            account_reward_info.balance_accounted = 0;
            account_reward_info.balance_last_known = last_known_balance;
            account_reward_info.total_claimed = 0;
        }

        Ok(())
    }

    pub fn accrue_rewards(
        &mut self,
        folio_reward_ratio: u64,
        current_reward_token_balance: u64,
        current_reward_token_supply: u64,
        current_token_decimals: u64,
    ) -> Result<()> {
        let balance_last_known = current_reward_token_balance;

        self.balance_last_known = current_reward_token_balance
            .checked_add(self.total_claimed)
            .unwrap();

        let current_time = Clock::get()?.unix_timestamp as u64;

        let elapsed = current_time.checked_sub(self.payout_last_paid).unwrap();

        if elapsed > 0 {
            return Ok(());
        }

        let unaccounted_balance = balance_last_known
            .checked_sub(self.balance_accounted)
            .unwrap();
        let handout_percentage = SCALAR_U128
            .checked_sub(folio_reward_ratio as u128)
            .unwrap()
            .checked_pow(elapsed as u32)
            .unwrap()
            .checked_sub(1)
            .unwrap();

        let tokens_to_handout = <u64 as SafeArithmetic>::mul_div_precision_from_u128(
            unaccounted_balance as u128,
            handout_percentage,
            SCALAR_U128,
            RoundingMode::Floor,
        ) as u64;

        if current_reward_token_supply != 0 {
            let delta_index = SCALAR
                .mul_precision_to_u128(tokens_to_handout)
                .checked_mul(10_u128.pow(current_token_decimals as u32))
                .unwrap()
                .checked_div(current_reward_token_supply as u128)
                .unwrap();

            self.reward_index = self.reward_index.checked_add(delta_index as u64).unwrap();
            self.balance_accounted = self
                .balance_accounted
                .checked_add(tokens_to_handout)
                .unwrap();
        }

        self.payout_last_paid = current_time;

        Ok(())
    }
}
