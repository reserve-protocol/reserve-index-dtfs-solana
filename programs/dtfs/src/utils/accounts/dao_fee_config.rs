use anchor_lang::prelude::*;
use shared::check_condition;
use shared::errors::ErrorCode;

use crate::state::DAOFeeConfig;

impl DAOFeeConfig {
    pub fn init_or_update_dao_fee_config(
        dao_fee_config: &mut Account<DAOFeeConfig>,
        context_bump: u8,
        fee_recipient: Option<Pubkey>,
        fee_recipient_numerator: Option<u64>,
    ) -> Result<()> {
        let account_info_dao_fee_config = dao_fee_config.to_account_info();

        let data = account_info_dao_fee_config.try_borrow_mut_data()?;
        let mut disc_bytes = [0u8; 8];
        disc_bytes.copy_from_slice(&data[..8]);

        let discriminator = u64::from_le_bytes(disc_bytes);

        drop(data);

        if discriminator == 0 {
            // Not initialized yet
            dao_fee_config.bump = context_bump;
            dao_fee_config.fee_recipient = fee_recipient.ok_or(ErrorCode::InvalidFeeRecipient)?;
            dao_fee_config.fee_recipient_numerator =
                fee_recipient_numerator.ok_or(ErrorCode::InvalidFeeRecipientNumerator)?;
        } else {
            check_condition!(dao_fee_config.bump == context_bump, InvalidBump);

            if let Some(fee_recipient) = fee_recipient {
                dao_fee_config.fee_recipient = fee_recipient;
            }

            if let Some(fee_recipient_numerator) = fee_recipient_numerator {
                dao_fee_config.fee_recipient_numerator = fee_recipient_numerator;
            }
        }

        Ok(())
    }
}
