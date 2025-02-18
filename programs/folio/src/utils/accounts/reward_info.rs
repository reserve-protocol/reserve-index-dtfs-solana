use crate::state::RewardInfo;
use crate::utils::math_util::Decimal;
use crate::utils::Rounding;
use anchor_lang::prelude::*;
use shared::check_condition;
use shared::errors::ErrorCode;

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
            account_reward_info.reward_index = 0u128;
            account_reward_info.balance_accounted = 0;
            account_reward_info.balance_last_known = last_known_balance as u128;
            account_reward_info.total_claimed = 0;
        }

        Ok(())
    }

    pub fn accrue_rewards(
        &mut self,
        folio_reward_ratio: u128,          // D18
        current_reward_token_balance: u64, // D9
        // Represent the supply of tokens that are staked in the governance account
        current_staked_token_balance: u64, // D9
        current_token_decimals: u8,
        current_time: u64,
    ) -> Result<()> {
        let (elapsed, overflow) = current_time.overflowing_sub(self.payout_last_paid);

        if elapsed == 0 || overflow {
            return Ok(());
        }

        let balance_last_known = self.balance_last_known;

        self.balance_last_known = Decimal::from_token_amount(current_reward_token_balance)? // D18
            .add(&Decimal::from_scaled(self.total_claimed))? // D18
            .to_scaled(Rounding::Ceiling)?; // D18

        // All in D18, so we keep it that way
        let unaccounted_balance = balance_last_known
            .checked_sub(self.balance_accounted)
            .ok_or(ErrorCode::MathOverflow)?;

        // Reward ratio already in D18
        let reward_ratio_decimal = Decimal::from_scaled(folio_reward_ratio);

        let base = Decimal::ONE_E18.sub(&reward_ratio_decimal)?;
        let pow_result = base.pow(elapsed)?;

        let handout_percentage = Decimal::ONE_E18.sub(&pow_result)?.sub(&Decimal::ONE)?;

        // {reward} = {reward} * D18{1} / D18
        let tokens_to_handout = Decimal::from_scaled(unaccounted_balance)
            .mul(&handout_percentage)?
            .div(&Decimal::ONE_E18)?;

        if current_staked_token_balance > 0 {
            self.calculate_delta_index(
                &tokens_to_handout,
                current_staked_token_balance,
                current_token_decimals,
            )?;

            self.balance_accounted = self
                .balance_accounted
                .checked_add(tokens_to_handout.to_scaled(Rounding::Ceiling)?)
                .ok_or(ErrorCode::MathOverflow)?;
        }

        self.payout_last_paid = current_time;

        Ok(())
    }

    pub fn calculate_delta_index(
        &mut self,
        tokens_to_handout: &Decimal,      // D18
        current_reward_token_supply: u64, // D9
        current_token_decimals: u8,
    ) -> Result<()> {
        let current_reward_token_supply = Decimal::from_scaled(current_reward_token_supply as u128);

        // D18+decimals{reward/share} = D18 * {reward} * decimals / {share}
        let current_token_decimals_exponent = Decimal::from_scaled(
            10u128
                .checked_pow(current_token_decimals as u32)
                .ok_or(ErrorCode::MathOverflow)?,
        );

        let delta_index = Decimal::ONE_E18 // D18
            .mul(tokens_to_handout)? // D18 * D18 = D36
            .mul(&current_token_decimals_exponent)? // D36 * D(decimals) i.e. D9 = D45
            // D45 / D(decimals) i.e. D9 = 36 (D decimals since mint token supply has the decimals included)
            .div(&current_reward_token_supply)?
            .div(&Decimal::ONE_E18)?; // Scale back down to D18

        self.reward_index = self
            .reward_index
            .checked_add(delta_index.to_scaled(Rounding::Ceiling)?)
            .ok_or(ErrorCode::MathOverflow)?;

        Ok(())
    }
}
