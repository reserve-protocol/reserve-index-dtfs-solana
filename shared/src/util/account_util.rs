use anchor_lang::{
    prelude::*,
    solana_program::{program::invoke_signed, system_instruction},
};

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
