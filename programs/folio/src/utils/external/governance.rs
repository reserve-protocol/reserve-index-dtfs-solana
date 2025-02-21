use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount};
use shared::check_condition;
use shared::constants::{GOVERNANCE_SEEDS, SPL_GOVERNANCE_PROGRAM_ID};
use shared::errors::ErrorCode;

pub struct GovernanceUtil;
/*
All of the deserializing, etc is done manually rather than using the spl-governance crate
This is because of dependencies issues with the solana version of the program.
It's fairly straightforward to replicate the logic here.
*/
impl GovernanceUtil {
    #[cfg(not(tarpaulin_include))]
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

        // Skip GovernanceAccountType (1 byte)
        // Skip realm (32 bytes)
        // Skip governing_token_mint (32 bytes)
        // Skip governing_token_owner (32 bytes)
        // Total to skip: 97 bytes

        let start_index = 97;

        if data_governance_account.len() < start_index + 8 {
            return Err(ErrorCode::InvalidAccountData.into());
        }

        let deposit_amount = u64::from_le_bytes(
            data_governance_account[start_index..start_index + 8]
                .try_into()
                .unwrap(),
        );

        Ok(deposit_amount)
    }

    #[cfg(not(tarpaulin_include))]
    pub fn get_realm_staked_balance_and_mint_decimals(
        realm: &Pubkey,
        governing_token_mint: &AccountInfo,
        holding_token_account_info: &AccountInfo,
    ) -> Result<(u64, u8)> {
        let governing_token_mint_key = governing_token_mint.key();
        let holding_pda = Pubkey::find_program_address(
            &[
                GOVERNANCE_SEEDS,
                realm.as_ref(),
                governing_token_mint_key.as_ref(),
            ],
            &SPL_GOVERNANCE_PROGRAM_ID,
        )
        .0;

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
