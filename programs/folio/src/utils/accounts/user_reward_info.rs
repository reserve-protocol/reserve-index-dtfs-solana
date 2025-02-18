use std::io::Write;

use crate::state::{RewardInfo, UserRewardInfo};
use crate::utils::account_util::init_pda_account_rent;
use crate::utils::{Decimal, Rounding};
use crate::ID as FOLIO_ID;
use anchor_lang::{prelude::*, Discriminator};
use shared::check_condition;
use shared::constants::USER_REWARD_INFO_SEEDS;
use shared::errors::ErrorCode;

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
                cursor.write_all(&0u128.to_le_bytes())?;
                cursor.write_all(&0u128.to_le_bytes())?;
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

    pub fn accrue_rewards(
        &mut self,
        reward_info: &RewardInfo,
        user_governance_balance: u64, //D9
    ) -> Result<()> {
        // D18+decimals{reward/share}
        let (delta_result, overflow) = reward_info
            .reward_index
            .overflowing_sub(self.last_reward_index);

        if !overflow && delta_result != 0u128 {
            self.calculate_and_update_accrued_rewards(user_governance_balance, delta_result)?;

            self.last_reward_index = reward_info.reward_index;
        };

        Ok(())
    }

    pub fn calculate_and_update_accrued_rewards(
        &mut self,
        user_governance_balance: u64, // D9
        delta_result: u128,           // D18
    ) -> Result<()> {
        // Token balances always in D9, but we want to calculate accrued rewards in D18 for precision
        let user_balance_decimal = Decimal::from_token_amount(user_governance_balance)?;

        // When we calculate accrue rewards, the total rewards already has the mint decimals
        // So we dont need to do anything with the decimals

        // Accumulate rewards by multiplying user tokens by index and adding on unclaimed
        // {reward} = {share} * D18+decimals{reward/share} / D18
        let supplier_delta = user_balance_decimal
            .mul(&Decimal::from_scaled(delta_result))?
            .div(&Decimal::ONE_E18)?;

        self.accrued_rewards = self
            .accrued_rewards
            .checked_add(supplier_delta.to_scaled(Rounding::Floor)?)
            .ok_or(ErrorCode::MathOverflow)?;

        Ok(())
    }
}
