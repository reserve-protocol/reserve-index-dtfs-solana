use crate::state::RewardInfo;
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
            account_reward_info.reward_index = 0;
            account_reward_info.balance_accounted = 0;
            account_reward_info.balance_last_known = last_known_balance;
            account_reward_info.total_claimed = 0;
        }

        Ok(())
    }
}
