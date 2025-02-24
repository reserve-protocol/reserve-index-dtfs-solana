use anchor_lang::prelude::*;
use shared::check_condition;
use shared::errors::ErrorCode;

use crate::state::{DAOFeeConfig, FolioFeeConfig};

impl FolioFeeConfig {
    /// Initialize or update the Folio fee config.
    /// If the Folio fee config is not initialized, it will be initialized with the given fee numerator and fee floor.
    /// If the Folio fee config is already initialized, it will update the fee numerator and fee floor.
    ///
    /// # Arguments
    /// * `folio_fee_config` - The account info of the FolioFeeConfig account.
    /// * `dao_fee_config` - The account info of the DAOFeeConfig account.
    /// * `context_bump` - The bump of the folio fee config account in the context.
    /// * `fee_numerator` - The fee numerator of the Folio, scaled in D18.
    /// * `fee_floor` - The fee floor of the Folio, scaled in D18.
    #[cfg(not(tarpaulin_include))]
    pub fn init_or_update_folio_fee_config(
        folio_fee_config: &mut Account<FolioFeeConfig>,
        dao_fee_config: &DAOFeeConfig,
        context_bump: u8,
        fee_numerator: Option<u128>,
        fee_floor: Option<u128>,
    ) -> Result<()> {
        let account_info_folio_fee_config = folio_fee_config.to_account_info();

        let data = account_info_folio_fee_config.try_borrow_mut_data()?;
        let mut disc_bytes = [0u8; 8];
        disc_bytes.copy_from_slice(&data[..8]);

        let discriminator = u64::from_le_bytes(disc_bytes);

        drop(data);

        if discriminator == 0 {
            // Not initialized yet
            folio_fee_config.bump = context_bump;
            folio_fee_config.fee_numerator =
                fee_numerator.unwrap_or(dao_fee_config.default_fee_numerator);
            folio_fee_config.fee_floor = fee_floor.unwrap_or(dao_fee_config.default_fee_floor);
        } else {
            check_condition!(folio_fee_config.bump == context_bump, InvalidBump);

            if let Some(fee_numerator) = fee_numerator {
                folio_fee_config.fee_numerator = fee_numerator;
            }

            if let Some(fee_floor) = fee_floor {
                folio_fee_config.fee_floor = fee_floor;
            }
        }

        Ok(())
    }
}
