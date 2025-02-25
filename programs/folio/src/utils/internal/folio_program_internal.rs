use crate::instructions::stake::accrue_rewards::*;
use crate::state::{Actor, Folio, FolioRewardTokens};
use crate::utils::FolioStatus;
use anchor_lang::prelude::*;

pub struct FolioProgramInternal {}

impl FolioProgramInternal {
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
