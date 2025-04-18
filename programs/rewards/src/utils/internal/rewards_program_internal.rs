use crate::{instructions::accrue_rewards::*, state::RewardTokens};
use anchor_lang::prelude::*;

/// Utility struct for internal functions of the rewards program. Used to call other actions that
/// are instructions within the rewards program.
pub struct RewardsProgramInternal {}

impl RewardsProgramInternal {
    /// Calls the accrue rewards instruction directly, without actually doing a CPI.
    ///
    /// # Arguments
    /// * `system_program` - The system program.
    /// * `token_program` - The token program.
    /// * `realm` - The realm account.
    /// * `governance_token_mint` - The governance token mint.
    /// * `governance_staked_token_account` - The governance staked token account that tracks all the staked token within the realm.
    /// * `user` - The user account.
    /// * `caller_governance_token_account` - The caller governance token account that tracks the user's governance token balance that is staked.
    /// * `reward_tokens` - The reward tokens account.
    /// * `remaining_accounts` - The remaining accounts.
    /// * `token_reward_token_account_is_mutable` - Say if the token rewards' token account is mutable or not, as we do a check on the accrue_rewards side,
    ///   but depending on where the instruction is called from, it might be mutable or not.
    #[allow(clippy::too_many_arguments)]
    pub fn accrue_rewards<'info>(
        system_program: &AccountInfo<'info>,
        token_program: &AccountInfo<'info>,
        realm: &AccountInfo<'info>,
        governance_token_mint: &AccountInfo<'info>,
        governance_staked_token_account: &AccountInfo<'info>,
        user: &AccountInfo<'info>,
        caller_governance_token_account: &AccountInfo<'info>,
        reward_tokens: &AccountLoader<'info, RewardTokens>,
        remaining_accounts: &'info [AccountInfo<'info>],
        token_reward_token_account_is_mutable: bool,
    ) -> Result<()> {
        accrue_rewards(
            system_program,
            token_program,
            realm,
            governance_token_mint,
            governance_staked_token_account,
            user,
            caller_governance_token_account,
            user,
            caller_governance_token_account,
            reward_tokens,
            remaining_accounts,
            token_reward_token_account_is_mutable,
        )?;

        Ok(())
    }
}
