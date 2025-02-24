/*
Not really a callback, but it's related to when a bid is being sent and the user wants to have a middle "step". So
this utility is to make a generalized cpi call.
*/

use anchor_lang::{prelude::*, solana_program::instruction::Instruction};

#[cfg(not(tarpaulin_include))]
pub fn cpi_call(remaining_accounts: &[AccountInfo], data: Vec<u8>) -> Result<()> {
    if !remaining_accounts.is_empty() {
        let callback_program = &remaining_accounts[0];
        let callback_accounts = &remaining_accounts[1..];

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
