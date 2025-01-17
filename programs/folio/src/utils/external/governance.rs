use anchor_lang::prelude::*;
use shared::check_condition;
use shared::constants::{GOVERNANCE_SEEDS, SPL_GOVERNANCE_PROGRAM_ID};
use shared::errors::ErrorCode;

pub struct GovernanceUtil;

impl GovernanceUtil {
    pub fn get_governance_account_balance(
        token_owner_record_governance_account: &AccountInfo,
        realm: &Pubkey,
        reward_token: &Pubkey,
        user: &Pubkey,
    ) -> Result<u64> {
        let (governance_account_pda, _) = Pubkey::find_program_address(
            &[
                GOVERNANCE_SEEDS,
                realm.as_ref(),
                reward_token.as_ref(),
                user.as_ref(),
            ],
            &SPL_GOVERNANCE_PROGRAM_ID,
        );

        check_condition!(
            token_owner_record_governance_account.key() == governance_account_pda,
            InvalidGovernanceAccount
        );

        let data_governance_account = token_owner_record_governance_account.try_borrow_data()?;
        let governance_account_parsed =
            spl_governance::state::token_owner_record::TokenOwnerRecordV2::deserialize(
                &mut &data_governance_account[..],
            )?;

        Ok(governance_account_parsed.governing_token_deposit_amount)
    }

    pub fn folio_owner_is_realm(realm: &AccountInfo) -> Result<()> {
        let realm_account_data = realm.try_borrow_data()?;
        spl_governance::state::realm::RealmV2::deserialize(&mut &realm_account_data[..])?;

        Ok(())
    }
}
