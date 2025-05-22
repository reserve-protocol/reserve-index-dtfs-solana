use crate::state::RewardInfo;
use anchor_lang::prelude::*;
use shared::check_condition;
use shared::errors::ErrorCode;
use shared::utils::math_util::Decimal;
use shared::utils::Rounding;

impl RewardInfo {
    /// Process the init if needed, meaning we initialize the account if it's not initialized yet and if it already is
    /// we check if the bump is correct.
    ///
    /// # Arguments
    /// * `account_reward_info` - The account to process the init for.
    /// * `context_bump` - The bump of the account provided in the anchor context.
    /// * `realm` - The realm the reward info belongs to.
    /// * `reward_token` - The reward token.
    /// * `raw_last_known_balance` - The last known balance of the reward token in the token account of RewardTokens.
    #[cfg(not(tarpaulin_include))]
    pub fn process_init_if_needed(
        account_reward_info: &mut Account<RewardInfo>,
        context_bump: u8,
        realm: &Pubkey,
        reward_token: &Pubkey,
        raw_last_known_balance: u64,
        index: u64,
    ) -> Result<()> {
        if account_reward_info.bump != 0 {
            check_condition!(account_reward_info.bump == context_bump, InvalidBump);
        } else {
            // Not initialized yet
            account_reward_info.bump = context_bump;
            account_reward_info.realm = *realm;
            account_reward_info.reward_token = *reward_token;
            account_reward_info.payout_last_paid = Clock::get()?.unix_timestamp as u64;
            account_reward_info.reward_index = 0u128;
            account_reward_info.balance_accounted = 0;
            account_reward_info.balance_last_known = raw_last_known_balance as u128;
            account_reward_info.total_claimed = 0;
            account_reward_info.index = index;
        }

        Ok(())
    }

    /// Accrue rewards for the "global" reward info account.
    ///
    /// # Arguments
    /// * `scaled_reward_ratio` - The reward ratio (D18).
    /// * `raw_current_reward_token_balance` - The current balance of the reward token of the RewardTokens account (D9).
    /// * `raw_current_staked_token_balance` - The current total staked balance of the governing mint token in the Realm (D9).
    /// * `current_token_decimals` - The decimals of the staked token.
    /// * `current_time` - The current time (seconds).
    pub fn accrue_rewards(
        &mut self,
        scaled_reward_ratio: u128,
        raw_current_reward_token_balance: u64,
        raw_current_staked_token_balance: u64,
        current_token_decimals: u8,
        current_time: u64,
    ) -> Result<()> {
        check_condition!(!self.is_disallowed, DisallowedRewardToken);

        let (elapsed, overflow) = current_time.overflowing_sub(self.payout_last_paid);

        if elapsed == 0 || overflow {
            return Ok(());
        }

        let scaled_balance_last_known = self.balance_last_known;

        self.balance_last_known = Decimal::from_token_amount(raw_current_reward_token_balance)?
            .add(&Decimal::from_scaled(self.total_claimed))?
            .to_scaled(Rounding::Ceiling)?;

        let scaled_unaccounted_balance = scaled_balance_last_known
            .checked_sub(self.balance_accounted)
            .ok_or(ErrorCode::MathOverflow)?;

        let scaled_reward_ratio = Decimal::from_scaled(scaled_reward_ratio);

        let scaled_base = Decimal::ONE_E18.sub(&scaled_reward_ratio)?;
        let scaled_pow_result = scaled_base.pow(elapsed)?;

        let scaled_handout_percentage = Decimal::ONE_E18
            .sub(&scaled_pow_result)?
            .sub(&Decimal::ONE)?; // rounds down

        // {reward} = {reward} * D18{1} / D18
        let scaled_tokens_to_handout = Decimal::from_scaled(scaled_unaccounted_balance)
            .mul(&scaled_handout_percentage)?
            .div(&Decimal::ONE_E18)?;

        if raw_current_staked_token_balance > 0 {
            self.calculate_delta_index(
                &scaled_tokens_to_handout,
                raw_current_staked_token_balance,
                current_token_decimals,
            )?;

            self.balance_accounted = self
                .balance_accounted
                .checked_add(scaled_tokens_to_handout.to_scaled(Rounding::Ceiling)?)
                .ok_or(ErrorCode::MathOverflow)?;
        }

        self.payout_last_paid = current_time;

        Ok(())
    }

    /// Calculate the delta index for the reward index.
    ///
    /// # Arguments
    /// * `scaled_tokens_to_handout` - The tokens to handout (D18).
    /// * `raw_current_reward_token_supply` - The current balance of the reward token of the RewardTokens account (D9).
    /// * `current_token_decimals` - The decimals of the reward token.
    pub fn calculate_delta_index(
        &mut self,
        scaled_tokens_to_handout: &Decimal,
        raw_current_reward_token_supply: u64,
        current_token_decimals: u8,
    ) -> Result<()> {
        let scaled_current_reward_token_supply =
            Decimal::from_scaled(raw_current_reward_token_supply as u128);

        // D18+decimals{reward/share} = D18 * {reward} * decimals / {share}
        let scaled_current_token_decimals_exponent = Decimal::from_scaled(
            10u128
                .checked_pow(current_token_decimals as u32)
                .ok_or(ErrorCode::MathOverflow)?,
        );

        let scaled_delta_index = Decimal::ONE_E18 // D18
            .mul(scaled_tokens_to_handout)? // D18 * D18 = D36
            .mul(&scaled_current_token_decimals_exponent)? // D36 * decimals i.e. D9 = D45
            .div(&scaled_current_reward_token_supply)? // D45 / decimals i.e. D9 = 36
            .div(&Decimal::ONE_E18)?; // Scale back down to D18 (D36 / D18)

        // D18+decimals{reward/share} += D18+decimals{reward/share}
        self.reward_index = self
            .reward_index
            .checked_add(scaled_delta_index.to_scaled(Rounding::Ceiling)?)
            .ok_or(ErrorCode::MathOverflow)?;

        Ok(())
    }
}
