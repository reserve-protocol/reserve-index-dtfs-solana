use crate::state::RewardInfo;
use anchor_lang::prelude::*;
use shared::check_condition;
use shared::constants::D18;
use shared::errors::ErrorCode;
use shared::util::math_util::{CustomPreciseNumber, U256Number};
use spl_math::uint::U256;

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
            account_reward_info.reward_index = U256Number::ZERO;
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
        let balance_last_known = self.balance_last_known;

        self.balance_last_known = current_reward_token_balance
            .checked_add(self.total_claimed)
            .ok_or(ErrorCode::MathOverflow)?;

        let current_time = Clock::get()?.unix_timestamp as u64;
        let elapsed = current_time
            .checked_sub(self.payout_last_paid)
            .ok_or(ErrorCode::MathOverflow)?;

        if elapsed == 0 {
            return Ok(());
        }

        let unaccounted_balance = balance_last_known
            .checked_sub(self.balance_accounted)
            .ok_or(ErrorCode::MathOverflow)?;

        let handout_percentage = CustomPreciseNumber::one_e18()
            .sub_generic(
                CustomPreciseNumber::one_e18()
                    .sub_generic(folio_reward_ratio)
                    .pow(elapsed),
            )
            .sub_generic(CustomPreciseNumber::from_u64(1));

        let tokens_to_handout = CustomPreciseNumber::from_u64(unaccounted_balance)
            .mul_div_generic(handout_percentage, CustomPreciseNumber::one_e18());

        if current_reward_token_supply != 0 {
            self.calculate_delta_index(
                tokens_to_handout.to_u128_floor(),
                current_reward_token_supply,
                current_token_decimals,
            )?;

            self.balance_accounted = self
                .balance_accounted
                .checked_add(tokens_to_handout.to_u64_floor())
                .ok_or(ErrorCode::MathOverflow)?;
        }

        self.payout_last_paid = current_time;

        Ok(())
    }

    pub fn calculate_delta_index(
        &mut self,
        tokens_to_handout: u128,
        current_reward_token_supply: u64,
        current_token_decimals: u64,
    ) -> Result<()> {
        let one_e18 = U256::from(D18);
        let tokens_to_handout = U256::from(tokens_to_handout);
        let current_reward_token_supply = U256::from(current_reward_token_supply);
        let current_token_decimals_exponent =
            U256::from(10).pow(U256::from(current_token_decimals));

        let delta_index = one_e18
            .checked_mul(tokens_to_handout)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_mul(current_token_decimals_exponent)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(current_reward_token_supply)
            .ok_or(ErrorCode::MathOverflow)?;

        let reward_index = self
            .reward_index
            .to_u256()
            .checked_add(delta_index)
            .ok_or(ErrorCode::MathOverflow)?;

        self.reward_index = U256Number::from_u256(reward_index);

        Ok(())
    }
}
