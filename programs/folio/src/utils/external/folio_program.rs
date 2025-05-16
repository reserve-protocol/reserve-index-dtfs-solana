use anchor_lang::{
    prelude::*,
    solana_program::{hash, instruction::Instruction, program::invoke_signed},
};

/// Mints a token from the new folio program
///
/// For this function in the new folio program, the accounts expected are (an example is given in mint_from_new_folio_program):
///
/// 1. Token program
/// 2. Folio (not mut, signer)
/// 3. Upgraded folio (not mut, not signer)
/// 4. Folio token mint (mut, not signer)
/// 5. To (mut, not signer)
///
/// The folio needs to sign the transaction.
/// The instruction name would be "crank_fee_distribution_previous_folio"
///
pub struct NewFolioProgram {}

impl NewFolioProgram {
    /// The size of the instruction discriminator in Anchor.
    const INSTRUCTION_DISCRIMINATOR_SIZE: usize = 8;

    /// The name of the crank fee distribution function in the new Folio program
    const CRANK_FEE_DISTRIBUTION_PREVIOUS_FOLIO_FUNCTION_NAME: &'static str =
        "mint_from_new_folio_program";

    /// The name of the update folio basket function in the new Folio program
    const UPDATE_BASKET_IN_NEW_FOLIO_PROGRAM_FUNCTION_NAME: &'static str =
        "update_basket_in_new_folio_program";

    /// Get the instruction discriminator for a given instruction name.
    ///
    /// # Arguments
    /// * `instruction_name` - The name of the instruction.
    ///
    /// Returns the instruction discriminator.
    fn get_instruction_discriminator(instruction_name: &str) -> [u8; 8] {
        // Anchor's instruction discriminator is a hash of the instruction name prepended with "global:"
        let preimage = format!("global:{}", instruction_name);

        let mut hasher = hash::Hasher::default();

        hasher.hash(preimage.as_bytes());

        let hash_result = hasher.result();

        let mut discriminator = [0u8; Self::INSTRUCTION_DISCRIMINATOR_SIZE];

        discriminator.copy_from_slice(&hash_result.to_bytes()[..8]);

        discriminator
    }

    /// Mints a token from the new folio program
    ///
    /// # Arguments
    /// * `new_folio_program` - The new folio program to call
    /// * `token_program` - The token program to use
    /// * `folio` - The folio to use
    /// * `upgraded_folio` - The upgraded folio to use
    /// * `folio_token_mint` - The folio token mint to use
    /// * `to` - The account to mint the token to
    /// * `signer_seeds` - The signer seeds to use (folio needs to sign)
    /// * `amount` - The amount to mint
    #[cfg(not(tarpaulin_include))]
    pub fn mint_from_new_folio_program<'info>(
        new_folio_program: &AccountInfo<'info>,
        token_program: &AccountInfo<'info>,
        folio: &AccountInfo<'info>,
        upgraded_folio: &AccountInfo<'info>,
        folio_token_mint: &AccountInfo<'info>,
        to: &AccountInfo<'info>,
        old_folio_program: &AccountInfo<'info>,
        program_registrar: &AccountInfo<'info>,
        signer_seeds: &[&[&[u8]]],
        amount: u64,
    ) -> Result<()> {
        let account_metas = vec![
            AccountMeta::new_readonly(token_program.key(), false),
            AccountMeta::new_readonly(folio.key(), true),
            AccountMeta::new_readonly(upgraded_folio.key(), false),
            AccountMeta::new(folio_token_mint.key(), false),
            AccountMeta::new(to.key(), false),
            AccountMeta::new_readonly(old_folio_program.key(), false),
            AccountMeta::new_readonly(program_registrar.key(), false),
        ];

        let mut data = NewFolioProgram::get_instruction_discriminator(
            Self::CRANK_FEE_DISTRIBUTION_PREVIOUS_FOLIO_FUNCTION_NAME,
        )
        .to_vec();
        data.extend_from_slice(&amount.to_le_bytes());

        invoke_signed(
            &Instruction {
                program_id: new_folio_program.key(),
                accounts: account_metas,
                data: data.clone(),
            },
            &[
                new_folio_program.to_account_info(),
                token_program.to_account_info(),
                folio.to_account_info(),
                upgraded_folio.to_account_info(),
                folio_token_mint.to_account_info(),
                to.to_account_info(),
                program_registrar.to_account_info(),
                old_folio_program.to_account_info(),
            ],
            signer_seeds,
        )?;

        Ok(())
    }

    pub fn update_folio_basket_in_new_folio_program<'info>(
        old_folio: &AccountInfo<'info>,
        new_folio: &AccountInfo<'info>,
        old_folio_basket: &AccountInfo<'info>,
        new_folio_basket: &AccountInfo<'info>,
        token_mint: &AccountInfo<'info>,
        folio_token_account: &AccountInfo<'info>,
        program_registrar: &AccountInfo<'info>,
        new_folio_program: &AccountInfo<'info>,
        signer_seeds: &[&[&[u8]]],
    ) -> Result<()> {
        let account_metas = vec![
            AccountMeta::new_readonly(old_folio.key(), true),
            AccountMeta::new(new_folio.key(), false),
            AccountMeta::new_readonly(old_folio_basket.key(), false),
            AccountMeta::new(new_folio_basket.key(), false),
            AccountMeta::new_readonly(token_mint.key(), false),
            AccountMeta::new_readonly(folio_token_account.key(), false),
            AccountMeta::new_readonly(program_registrar.key(), false),
        ];

        let data = NewFolioProgram::get_instruction_discriminator(
            Self::UPDATE_BASKET_IN_NEW_FOLIO_PROGRAM_FUNCTION_NAME,
        )
        .to_vec();

        invoke_signed(
            &Instruction {
                program_id: new_folio_program.key(),
                accounts: account_metas,
                data: data.clone(),
            },
            &[
                old_folio.to_account_info(),
                new_folio.to_account_info(),
                old_folio_basket.to_account_info(),
                new_folio_basket.to_account_info(),
                token_mint.to_account_info(),
                folio_token_account.to_account_info(),
                program_registrar.to_account_info(),
            ],
            signer_seeds,
        )?;

        Ok(())
    }
}
