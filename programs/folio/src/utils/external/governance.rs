use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount};
use shared::check_condition;
use shared::constants::{GOVERNANCE_SEEDS, SPL_GOVERNANCE_PROGRAM_ID};
use shared::errors::ErrorCode;
use spl_governance::state::realm::get_governing_token_holding_address;

pub struct GovernanceUtil;

impl GovernanceUtil {
    pub fn get_governance_account_balance(
        token_owner_record_governance_account: &AccountInfo,
        realm: &Pubkey,
        folio_token_mint: &Pubkey,
        user: &Pubkey,
    ) -> Result<u64> {
        let (governance_account_pda, _) = Pubkey::find_program_address(
            &[
                GOVERNANCE_SEEDS,
                realm.as_ref(),
                folio_token_mint.as_ref(),
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

    pub fn get_realm_staked_balance_and_mint_decimals(
        realm: &Pubkey,
        governing_token_mint: &AccountInfo,
        holding_token_account_info: &AccountInfo,
    ) -> Result<(u64, u8)> {
        let holding_pda = get_governing_token_holding_address(
            &SPL_GOVERNANCE_PROGRAM_ID,
            realm,
            governing_token_mint.key,
        );

        check_condition!(
            holding_token_account_info.key() == holding_pda,
            InvalidHoldingTokenAccount
        );

        let mint_account_data = governing_token_mint.try_borrow_data()?;
        let mint = Mint::try_deserialize(&mut &mint_account_data[..])?;

        let token_account_data = holding_token_account_info.try_borrow_data()?;
        let token_account = TokenAccount::try_deserialize(&mut &token_account_data[..])?;

        Ok((token_account.amount, mint.decimals))
    }
}
