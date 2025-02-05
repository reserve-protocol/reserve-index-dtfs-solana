use std::io::Write;

use crate::state::{RewardInfo, UserRewardInfo};
use crate::ID as FOLIO_ID;
use anchor_lang::{prelude::*, Discriminator};
use shared::check_condition;
use shared::constants::{D18, USER_REWARD_INFO_SEEDS};
use shared::errors::ErrorCode;
use shared::util::account_util::init_pda_account_rent;
use shared::util::math_util::U256Number;
use spl_math::uint::U256;

impl UserRewardInfo {
    pub fn process_init_if_needed<'info>(
        account_user_reward_info: &'info AccountInfo<'info>,
        system_program: &AccountInfo<'info>,
        payer: &AccountInfo<'info>,
        for_user: &Pubkey,
        context_bump: u8,
        folio: &Pubkey,
        reward_token: &Pubkey,
        reward_info: &Account<RewardInfo>,
        user_balance: u64,
    ) -> Result<()> {
        if account_user_reward_info.data_len() == 0 {
            {
                let self_signer_seeds = &[
                    USER_REWARD_INFO_SEEDS,
                    folio.as_ref(),
                    reward_token.as_ref(),
                    for_user.as_ref(),
                    &[context_bump],
                ];
                let self_signer = &[&self_signer_seeds[..]];

                init_pda_account_rent(
                    account_user_reward_info,
                    8 + UserRewardInfo::INIT_SPACE,
                    payer,
                    &FOLIO_ID,
                    system_program,
                    self_signer,
                )?;

                let data = &mut **account_user_reward_info.try_borrow_mut_data()?;

                data[..8].copy_from_slice(&UserRewardInfo::DISCRIMINATOR);

                let mut cursor = &mut data[8..];
                cursor.write_all(&context_bump.to_le_bytes())?;
                cursor.write_all(folio.as_ref())?;
                cursor.write_all(reward_token.as_ref())?;

                for &word in &U256Number::ZERO.value {
                    cursor.write_all(&word.to_le_bytes())?; // Write each u64 as little-endian bytes
                }

                cursor.write_all(&0u64.to_le_bytes())?;
            }
            {
                let mut new_account_user_reward_info: Account<UserRewardInfo> =
                    Account::<UserRewardInfo>::try_from_unchecked(account_user_reward_info)?;

                new_account_user_reward_info.accrue_rewards(reward_info, user_balance)?;

                // Serialize updated struct
                let mut data = account_user_reward_info.try_borrow_mut_data()?;
                let mut writer = std::io::Cursor::new(&mut data[..]);
                new_account_user_reward_info.try_serialize(&mut writer)?;
            }
        } else {
            let mut account_user_reward_info =
                Account::<UserRewardInfo>::try_from(account_user_reward_info)?;

            check_condition!(account_user_reward_info.bump == context_bump, InvalidBump);

            account_user_reward_info.accrue_rewards(reward_info, user_balance)?;

            // Serialize updated struct
            let account_user_reward_info_account_info = account_user_reward_info.to_account_info();
            let mut data = account_user_reward_info_account_info.try_borrow_mut_data()?;
            let mut writer = std::io::Cursor::new(&mut data[..]);
            account_user_reward_info.try_serialize(&mut writer)?;
        }

        Ok(())
    }

    pub fn accrue_rewards(&mut self, reward_info: &RewardInfo, user_balance: u64) -> Result<()> {
        // TODO Fix math
        let delta_result = U256::from(1);
        let overflow = false;
        // let (delta_result, overflow) = reward_info
        //     .reward_index
        //     .to_u256()
        //     .overflowing_sub(self.last_reward_index.to_u256());
        if !overflow && delta_result != U256::from(0) {
            self.calculate_and_update_accrued_rewards(user_balance, delta_result)?;

            self.last_reward_index = reward_info.reward_index;
        };

        Ok(())
    }

    pub fn calculate_and_update_accrued_rewards(
        &mut self,
        user_balance: u64,
        delta_result: U256,
    ) -> Result<()> {
        let user_balance_u256 = U256::from(user_balance);

        // When we calculate accrue rewards, the total rewards already has the mint decimals
        // So we dont need to do anything with the decimals

        let intermediate = user_balance_u256
            .checked_mul(delta_result)
            .ok_or(ErrorCode::MathOverflow)?;

        let supplier_delta = intermediate
            .checked_div(D18)
            .ok_or(ErrorCode::MathOverflow)?;

        self.accrued_rewards = self
            .accrued_rewards
            .checked_add(supplier_delta.as_u64())
            .ok_or(ErrorCode::MathOverflow)?;

        Ok(())
    }
}
