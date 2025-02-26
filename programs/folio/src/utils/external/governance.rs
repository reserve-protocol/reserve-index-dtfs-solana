use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount};
use shared::check_condition;
use shared::constants::GOVERNANCE_ACCOUNT_SEEDS;
use shared::constants::{GOVERNANCE_SEEDS, SPL_GOVERNANCE_PROGRAM_ID};
use shared::errors::ErrorCode;

/// Utility struct for the spl governance program.
/// All of the deserializing of the spl governance accounts is done manually rather than using
/// the spl-governance crate, because of dependencies issues with the solana version of the program.
pub struct GovernanceUtil;

impl GovernanceUtil {
    /// Get the staked balance of a user in a realm for a given governance token mint.
    /// Also validates that the account PDA is valid.
    ///
    /// # Arguments
    /// * `token_owner_record_governance_account` - The account info of the token owner record governance account of the user.
    /// * `realm` - The realm pubkey.
    /// * `governing_token_mint` - The governance token mint pubkey.
    /// * `user` - The user pubkey.
    #[cfg(not(tarpaulin_include))]
    pub fn get_governance_account_balance(
        token_owner_record_governance_account: &AccountInfo,
        realm: &Pubkey,
        governing_token_mint: &Pubkey,
        user: &Pubkey,
    ) -> Result<u64> {
        let (governance_account_pda, _) = Pubkey::find_program_address(
            &[
                GOVERNANCE_SEEDS,
                realm.as_ref(),
                governing_token_mint.as_ref(),
                user.as_ref(),
            ],
            &SPL_GOVERNANCE_PROGRAM_ID,
        );

        check_condition!(
            token_owner_record_governance_account.key() == governance_account_pda,
            InvalidGovernanceAccount
        );

        let data_governance_account = token_owner_record_governance_account.try_borrow_data()?;

        /*
        Skip GovernanceAccountType (1 byte)
        Skip realm (32 bytes)
        Skip governing_token_mint (32 bytes)
        Skip governing_token_owner (32 bytes)
        Total to skip: 97 bytes
        */

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

    /// Get the total staked balance and mint decimals of a realm for a given governance token mint.
    /// Also validates that the holding token account PDA is valid.
    ///
    /// # Arguments
    /// * `realm` - The realm pubkey.
    /// * `governing_token_mint` - The governing token mint account info.
    /// * `holding_token_account_info` - The holding token account info.
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

    /// Validate that the governance account (representing most likely the folio owner, auction launcher, etc)
    /// is valid for a given realm based on the governance seeds.
    ///
    /// # Arguments
    /// * `realm` - The realm pubkey.
    /// * `governance_account` - The governance account info.
    #[cfg(not(tarpaulin_include))]
    pub fn validate_realm_is_valid(
        realm: &AccountInfo,
        governance_account: &AccountInfo,
    ) -> Result<()> {
        let realm_key = realm.key();

        // Get the governance seeds from the data of the governance account
        let data = governance_account.try_borrow_data()?;

        /*
        Skip GovernanceAccountType (1 byte)
        Skip realm (32 bytes)
        Total to skip: 33 bytes
        */

        let start_index = 33;

        if data.len() < start_index + 32 {
            return Err(ErrorCode::InvalidAccountData.into());
        }

        let governance_seed =
            Pubkey::new_from_array(data[start_index..start_index + 32].try_into().unwrap());

        let (governance_account_pda, _) = Pubkey::find_program_address(
            &[
                GOVERNANCE_ACCOUNT_SEEDS,
                realm_key.as_ref(),
                governance_seed.as_ref(),
            ],
            &SPL_GOVERNANCE_PROGRAM_ID,
        );

        check_condition!(
            governance_account.key() == governance_account_pda,
            InvalidGovernanceAccount
        );

        Ok(())
    }
}
