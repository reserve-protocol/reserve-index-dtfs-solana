use anchor_lang::{
    prelude::*,
    solana_program::{program::invoke_signed, system_instruction},
};
use shared::{check_condition, errors::ErrorCode};

/// Helper function to validate the next account in an iterator.
///
/// # Arguments
///
/// * `iter`: The iterator to get the next account from.
/// * `must_be_signer`: Whether the account must be a signer.
/// * `must_be_writable`: Whether the account must be writable.
/// * `expected_owner`: The expected owner of the account.
///
/// # Returns
///
/// * `Ok(account)`: The next account in the iterator.
/// * `Err(ErrorCode::MissingRemainingAccount)`: If the iterator is empty.
/// * `Err(ErrorCode::AccountNotSigner)`: If the account is not a signer, and `must_be_signer` is true.
/// * `Err(ErrorCode::AccountNotWritable)`: If the account is not writable, and `must_be_writable` is true.
/// * `Err(ErrorCode::InvalidAccountOwner)`: If the account owner is not the expected owner (only if account is initialized).
#[cfg(not(tarpaulin_include))]
pub fn next_account<'b>(
    iter: &mut std::slice::Iter<'b, AccountInfo<'b>>,
    must_be_signer: bool,
    must_be_writable: bool,
    expected_owner: &Pubkey,
) -> Result<&'b AccountInfo<'b>> {
    let account = iter.next().ok_or(ErrorCode::MissingRemainingAccount)?;

    check_condition!(account.is_signer == must_be_signer, AccountNotSigner);

    check_condition!(account.is_writable == must_be_writable, AccountNotWritable);

    // Only check owner if account is initialized
    if !account.data_is_empty() {
        check_condition!(account.owner == expected_owner, InvalidAccountOwner);
    }

    Ok(account)
}

/// Helper function to initialize a PDA account.
///
/// # Arguments
///
/// * `account_to_init`: The account to initialize.
/// * `space`: The space to initialize the account with.
/// * `payer`: The payer of the rent for the account.
/// * `owner_program_id`: The program id of the owner of the account.
/// * `system_program`: The system program.
/// * `pda_signers_seeds`: The seeds to sign the transaction with.
///
/// # Returns
///
/// * `Ok(())`: The account was initialized successfully.
/// * `Err(ErrorCode::CreateAccountFailed)`: If the account was not initialized.
#[cfg(not(tarpaulin_include))]
pub fn init_pda_account_rent<'info>(
    account_to_init: &AccountInfo<'info>,
    space: usize,
    payer: &AccountInfo<'info>,
    owner_program_id: &Pubkey,
    system_program: &AccountInfo<'info>,
    pda_signers_seeds: &[&[&[u8]]],
) -> Result<()> {
    let rent = Rent::get()?;
    let rent_lamports = rent.minimum_balance(space);

    invoke_signed(
        &system_instruction::create_account(
            payer.key,
            account_to_init.key,
            rent_lamports,
            space as u64,
            owner_program_id,
        ),
        &[
            payer.clone(),
            account_to_init.clone(),
            system_program.clone(),
        ],
        pda_signers_seeds,
    )?;

    Ok(())
}
