use std::io::Write;

use crate::state::{RewardInfo, UserRewardInfo};
use crate::ID as FOLIO_ID;
use anchor_lang::{prelude::*, Discriminator};
use shared::check_condition;
use shared::constants::{SCALAR_U128, USER_REWARD_INFO_SEEDS};
use shared::errors::ErrorCode;
use shared::util::account_util::init_pda_account_rent;
use shared::util::math_util::{RoundingMode, SafeArithmetic};

impl UserRewardInfo {
    pub fn process_init_if_needed<'info>(
        account_user_reward_info: &'info AccountInfo<'info>,
        system_program: &AccountInfo<'info>,
        payer: &AccountInfo<'info>,
        context_bump: u8,
        folio: &Pubkey,
        reward_token: &Pubkey,
        reward_info: &Account<RewardInfo>,
        user_balance: u64,
        mint_decimals: u64,
    ) -> Result<()> {
        if account_user_reward_info.data_len() == 0 {
            {
                let self_signer_seeds = &[
                    USER_REWARD_INFO_SEEDS,
                    folio.as_ref(),
                    reward_token.as_ref(),
                    payer.key.as_ref(),
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
                cursor.write_all(&0u64.to_le_bytes())?;
                cursor.write_all(&0u64.to_le_bytes())?;
            }
            {
                let mut new_account_user_reward_info: Account<UserRewardInfo> =
                    Account::<UserRewardInfo>::try_from_unchecked(account_user_reward_info)?;

                new_account_user_reward_info.accrue_rewards(
                    reward_info,
                    user_balance,
                    mint_decimals,
                )?;
            }
        } else {
            let mut account_user_reward_info =
                Account::<UserRewardInfo>::try_from(account_user_reward_info)?;

            check_condition!(account_user_reward_info.bump == context_bump, InvalidBump);

            account_user_reward_info.accrue_rewards(reward_info, user_balance, mint_decimals)?;
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
