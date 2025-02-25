use anchor_lang::{
    prelude::*,
    solana_program::{hash, instruction::Instruction, program::invoke},
};
use shared::check_condition;
use shared::errors::ErrorCode;
pub struct FolioProgram {}

impl FolioProgram {
    const INSTRUCTION_DISCRIMINATOR_SIZE: usize = 8;
    const DISTRIBUTE_FEES_FUNCTION_NAME: &'static str = "distribute_fees";

    fn get_instruction_discriminator(instruction_name: &str) -> [u8; 8] {
        let preimage = format!("global:{}", instruction_name);

        let mut hasher = hash::Hasher::default();

        hasher.hash(preimage.as_bytes());

        let hash_result = hasher.result();

        let mut discriminator = [0u8; Self::INSTRUCTION_DISCRIMINATOR_SIZE];

        discriminator.copy_from_slice(&hash_result.to_bytes()[..8]);

        discriminator
    }

    fn get_next_index(fee_recipients: &AccountInfo) -> Result<u64> {
        let fee_recipients_data = fee_recipients.try_borrow_data()?;

        // Skip 8 bytes for discriminator
        // Skip 8 bytes for bump and padding
        check_condition!(fee_recipients_data.len() >= 24, InvalidFeeRecipient);

        let next_index = u64::from_le_bytes(fee_recipients_data[16..24].try_into().unwrap());

        Ok(next_index.checked_add(1).unwrap())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn distribute_fees_cpi<'a>(
        folio_program: &AccountInfo<'a>,
        rent: &AccountInfo<'a>,
        system_program: &AccountInfo<'a>,
        token_program: &AccountInfo<'a>,
        user: &AccountInfo<'a>,
        dao_fee_config: &AccountInfo<'a>,
        folio_fee_config: &AccountInfo<'a>,
        folio: &AccountInfo<'a>,
        folio_token_mint: &AccountInfo<'a>,
        fee_recipients: &AccountInfo<'a>,
        fee_distribution: &AccountInfo<'a>,
        dao_fee_recipient: &AccountInfo<'a>,
    ) -> Result<()> {
        // Won't distribute the fees if the fee recipients account is not initialized
        if fee_recipients.data_is_empty() {
            return Ok(());
        }

        let accounts = vec![
            rent.clone(),
            system_program.clone(),
            token_program.clone(),
            user.clone(),
            dao_fee_config.clone(),
            folio_fee_config.clone(),
            folio.clone(),
            folio_token_mint.clone(),
            fee_recipients.clone(),
            fee_distribution.clone(),
            dao_fee_recipient.clone(),
        ];

        let account_metas = vec![
            AccountMeta::new_readonly(rent.key(), false),
            AccountMeta::new_readonly(system_program.key(), false),
            AccountMeta::new_readonly(token_program.key(), false),
            AccountMeta::new(user.key(), true),
            AccountMeta::new_readonly(dao_fee_config.key(), false),
            AccountMeta::new_readonly(folio_fee_config.key(), false),
            AccountMeta::new(folio.key(), false),
            AccountMeta::new(folio_token_mint.key(), false),
            AccountMeta::new(fee_recipients.key(), false),
            AccountMeta::new(fee_distribution.key(), false),
            AccountMeta::new(dao_fee_recipient.key(), false),
        ];

        let mut data =
            FolioProgram::get_instruction_discriminator(Self::DISTRIBUTE_FEES_FUNCTION_NAME)
                .to_vec();
        data.extend_from_slice(&Self::get_next_index(fee_recipients)?.to_le_bytes());

        let instruction = Instruction {
            program_id: *folio_program.key,
            accounts: account_metas,
            data: data.to_vec(),
        };

        invoke(&instruction, &accounts)?;

        Ok(())
    }
}
