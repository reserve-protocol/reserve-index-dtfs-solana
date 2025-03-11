//! Rewards program utility functions (Reserve Protocol DTF)

use crate::error::GovernanceError;
use solana_program::instruction::{AccountMeta, Instruction};
use solana_program::program::invoke;
use solana_program::pubkey::Pubkey;
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    hash, pubkey,
};

/// Rewards program
pub struct RewardsProgram {}

impl RewardsProgram {
    const REWARDS_PROGRAM_ID: Pubkey = pubkey!("7GiMvNDHVY8PXWQLHjSf1REGKpiDsVzRr4p7Y3xGbSuf");

    const REMAINING_ACCOUNTS_GROUP_SIZE: usize = 4;

    fn get_instruction_discriminator(instruction_name: &str) -> [u8; 8] {
        let preimage = format!("global:{}", instruction_name);
        let mut hasher = hash::Hasher::default();
        hasher.hash(preimage.as_bytes());
        let hash_result = hasher.result();
        let mut discriminator = [0u8; 8];
        discriminator.copy_from_slice(&hash_result.to_bytes()[..8]);
        discriminator
    }

    /// Receives the remaining accounts from the instruction (expect in proper order), doesn't do validation as it's done on the Rewards Program side.
    /// Only thing it will validate is the actual program being called is the Rewards Program.
    #[allow(clippy::too_many_arguments)]
    pub fn accrue_rewards<'a>(
        realm_info: &AccountInfo<'a>,
        system_info: &AccountInfo<'a>,
        spl_token_info: &AccountInfo<'a>,
        // The caller of the instruction
        governing_token_owner_info: &AccountInfo<'a>,
        // Is the token account that has the total "staked" balance
        governing_token_holding_info: &AccountInfo<'a>,
        // The user's token owner record info (his staked balance)
        token_owner_record_info: &AccountInfo<'a>,
        // Accounts starting from the last next account info in parent function
        accounts: &[AccountInfo<'a>],
        // Accounts for the reward tokens (can be up to 4 x 4)
        reward_token_accounts: &[AccountInfo<'a>],
    ) -> ProgramResult {
        let accounts_iter = &mut accounts.iter();

        let rewards_program_info = next_account_info(accounts_iter)?;

        if *rewards_program_info.key != RewardsProgram::REWARDS_PROGRAM_ID
            || !rewards_program_info.executable
        {
            return Err(GovernanceError::InvalidRewardsProgram.into());
        }

        let reward_tokens = next_account_info(accounts_iter)?;
        let governing_token_mint = next_account_info(accounts_iter)?;

        // Won't do the extra user, for simplicity's sake

        let mut accounts = vec![
            system_info.clone(),
            spl_token_info.clone(),
            governing_token_owner_info.clone(),
            realm_info.clone(),
            reward_tokens.clone(),
            governing_token_mint.clone(),
            governing_token_holding_info.clone(),
            token_owner_record_info.clone(),
            // For user send the same as caller
            governing_token_owner_info.clone(),
            // For user's governance token account, send same as caller
            governing_token_owner_info.clone(),
        ];

        let mut account_metas = vec![
            AccountMeta::new_readonly(*system_info.key, false),
            AccountMeta::new_readonly(*spl_token_info.key, false),
            AccountMeta::new(*governing_token_owner_info.key, true),
            AccountMeta::new_readonly(*realm_info.key, false),
            AccountMeta::new_readonly(*reward_tokens.key, false),
            AccountMeta::new_readonly(*governing_token_mint.key, false),
            AccountMeta::new_readonly(*governing_token_holding_info.key, false),
            AccountMeta::new_readonly(*token_owner_record_info.key, false),
            // For user send the same as caller
            AccountMeta::new(*governing_token_owner_info.key, true),
            // For user's governance token account, send same as caller
            AccountMeta::new(*governing_token_owner_info.key, true),
        ];

        // Remaining accounts for the instruction on Rewards program
        let reward_token_accounts_iter = &mut reward_token_accounts.iter();
        for _ in 0..reward_token_accounts.len() / RewardsProgram::REMAINING_ACCOUNTS_GROUP_SIZE {
            let reward_token_mint = next_account_info(reward_token_accounts_iter)?;
            let reward_info_for_token_mint = next_account_info(reward_token_accounts_iter)?;
            let reward_token_rewards_token_account = next_account_info(reward_token_accounts_iter)?;
            let reward_info_for_caller = next_account_info(reward_token_accounts_iter)?;

            accounts.push(reward_token_mint.clone());
            accounts.push(reward_info_for_token_mint.clone());
            accounts.push(reward_token_rewards_token_account.clone());
            accounts.push(reward_info_for_caller.clone());

            account_metas.push(AccountMeta::new_readonly(*reward_token_mint.key, false));
            account_metas.push(AccountMeta::new(*reward_info_for_token_mint.key, false));
            account_metas.push(AccountMeta::new_readonly(
                *reward_token_rewards_token_account.key,
                false,
            ));
            account_metas.push(AccountMeta::new(*reward_info_for_caller.key, false));
        }

        let data = RewardsProgram::get_instruction_discriminator("accrue_rewards");

        let instruction = Instruction {
            program_id: *rewards_program_info.key,
            accounts: account_metas,
            data: data.to_vec(),
        };

        invoke(&instruction, &accounts)?;

        Ok(())
    }
}
