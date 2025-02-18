use anchor_lang::prelude::*;
use shared::check_condition;
use shared::constants::{FEE_DENOMINATOR, MAX_DAO_FEE, MAX_FEE_FLOOR};
use shared::errors::ErrorCode;

use crate::state::{DAOFeeConfig, FolioFeeConfig};

pub struct FeeDetails {
    pub fee_recipient: Pubkey,
    pub fee_denominator: u128,
    pub fee_numerator: u128,
    pub fee_floor: u128,
}

impl DAOFeeConfig {
    pub fn init_or_update_dao_fee_config(
        dao_fee_config: &mut Account<DAOFeeConfig>,
        context_bump: u8,
        fee_recipient: Option<Pubkey>,
        default_fee_numerator: Option<u128>,
        default_fee_floor: Option<u128>,
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
            dao_fee_config.default_fee_numerator = default_fee_numerator.unwrap_or(MAX_DAO_FEE);
            dao_fee_config.default_fee_floor = default_fee_floor.unwrap_or(MAX_FEE_FLOOR);
        } else {
            check_condition!(dao_fee_config.bump == context_bump, InvalidBump);

            if let Some(fee_recipient) = fee_recipient {
                dao_fee_config.fee_recipient = fee_recipient;
            }

            if let Some(default_fee_numerator) = default_fee_numerator {
                dao_fee_config.default_fee_numerator = default_fee_numerator;
            }

            if let Some(default_fee_floor) = default_fee_floor {
                dao_fee_config.default_fee_floor = default_fee_floor;
            }
        }

        Ok(())
    }

    pub fn get_fee_details(&self, folio_fee_config: &AccountInfo) -> Result<FeeDetails> {
        let mut fee_details = FeeDetails {
            fee_recipient: self.fee_recipient,
            fee_denominator: FEE_DENOMINATOR,
            fee_numerator: self.default_fee_numerator,
            fee_floor: self.default_fee_floor,
        };

        if !folio_fee_config.data_is_empty() {
            let folio_fee_config_data = folio_fee_config.try_borrow_mut_data()?;
            let folio_fee_config =
                FolioFeeConfig::try_deserialize(&mut &folio_fee_config_data[..])?;

            fee_details.fee_numerator = folio_fee_config.fee_numerator;
            fee_details.fee_floor = folio_fee_config.fee_floor;
        }

        Ok(fee_details)
    }
}
