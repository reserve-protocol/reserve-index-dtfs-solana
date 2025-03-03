use anchor_lang::{prelude::*, solana_program::instruction::Instruction};

const CALLBACK_PROGRAM_ID_INDEX: usize = 0;

/// Utility function to make a generalized CPI call to a program during a bid.
///
///
/// # Arguments
/// * `remaining_accounts` - The accounts expected by the callback program. Callback program id should always be the first remaining account in the list.
/// * `data` - The data expected by the callback program.
#[cfg(not(tarpaulin_include))]
pub fn cpi_call(remaining_accounts: &[AccountInfo], data: Vec<u8>) -> Result<()> {
    if !remaining_accounts.is_empty() {
        let callback_program = &remaining_accounts[CALLBACK_PROGRAM_ID_INDEX];
        let callback_accounts = &remaining_accounts[CALLBACK_PROGRAM_ID_INDEX + 1..];

        let callback_accounts_metas: Vec<anchor_lang::prelude::AccountMeta> = callback_accounts
            .iter()
            .map(|a| {
                if a.is_writable {
                    AccountMeta::new(*a.key, a.is_signer)
                } else {
                    AccountMeta::new_readonly(*a.key, a.is_signer)
                }
            })
            .collect();

        anchor_lang::solana_program::program::invoke(
            &Instruction {
                program_id: callback_program.key(),
                accounts: callback_accounts_metas,
                data: data.clone(),
            },
            callback_accounts,
        )?;
    }

    Ok(())
}
