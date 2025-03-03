use crate::instructions::stake::accrue_rewards::*;
use crate::state::{Actor, Folio, FolioRewardTokens};
use crate::utils::FolioStatus;
use anchor_lang::prelude::*;

/// Utility struct for internal functions of the Folio program. Used to call other actions that
/// are instructions within the folio program.
pub struct FolioProgramInternal {}

impl FolioProgramInternal {
    /// Calls the accrue rewards instruction directly, without actually doing a CPI.
    ///
    /// # Arguments
    /// * `system_program` - The system program.
    /// * `token_program` - The token program.
    /// * `realm` - The realm account.
    /// * `folio` - The folio account.
    /// * `actor` - The actor account for the Folio Owner.
    /// * `folio_owner` - The owner of the folio (most likely a governance account).
    /// * `governance_token_mint` - The governance token mint.
    /// * `governance_staked_token_account` - The governance staked token account that tracks all the staked token within the realm.
    /// * `user` - The user account.
    /// * `caller_governance_token_account` - The caller governance token account that tracks the user's governance token balance that is staked.
    /// * `folio_reward_tokens` - The folio reward tokens account.
    /// * `remaining_accounts` - The remaining accounts.
    /// * `fee_recipient_token_account_is_mutable` - Say if the fee recipient token account is mutable or not, as we do a check on the accrue_rewards side,
    ///                                              but depending on where the instruction is called from, it might be mutable or not.
    pub fn accrue_rewards<'info>(
        system_program: &AccountInfo<'info>,
        token_program: &AccountInfo<'info>,
        realm: &AccountInfo<'info>,
        folio: &AccountLoader<'info, Folio>,
        actor: &Account<'info, Actor>,
        folio_owner: &AccountInfo<'info>,
        governance_token_mint: &AccountInfo<'info>,
        governance_staked_token_account: &AccountInfo<'info>,
        user: &AccountInfo<'info>,
        caller_governance_token_account: &AccountInfo<'info>,
        folio_reward_tokens: &AccountLoader<'info, FolioRewardTokens>,
        remaining_accounts: &'info [AccountInfo<'info>],
        fee_recipient_token_account_is_mutable: bool,
    ) -> Result<()> {
        let loaded_folio = folio.load()?;

        // If the folio is not initializing or initialized, we don't need to accrue rewards.
        if ![FolioStatus::Initializing, FolioStatus::Initialized]
            .contains(&loaded_folio.status.into())
        {
            return Ok(());
        }

        accrue_rewards(
            system_program,
            token_program,
            realm,
            folio,
            actor,
            folio_owner,
            governance_token_mint,
            governance_staked_token_account,
            user,
            caller_governance_token_account,
            user,
            caller_governance_token_account,
            folio_reward_tokens,
            remaining_accounts,
            fee_recipient_token_account_is_mutable,
        )?;

        Ok(())
    }
}
