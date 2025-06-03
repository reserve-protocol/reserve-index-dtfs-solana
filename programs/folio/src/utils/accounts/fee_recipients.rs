use std::collections::BTreeSet;

use crate::events::FeeRecipientSet;
use crate::state::FeeRecipients;
use crate::utils::structs::FeeRecipient;
use anchor_lang::prelude::*;
use shared::constants::MAX_FEE_RECIPIENTS_PORTION;
use shared::errors::ErrorCode;
use shared::{check_condition, constants::MAX_FEE_RECIPIENTS};

impl FeeRecipients {
    /// Process the init if needed, meaning we initialize the account if it's not initialized yet and if it already is
    /// we check if the bump is correct.
    ///
    /// # Arguments
    /// * `account_loader_fee_recipients` - The account loader for the fee recipients.
    /// * `context_bump` - The bump of the account provided in the anchor context.
    /// * `folio` - The folio the fee recipients belong to.
    ///
    /// # Returns
    /// * `bool` - True if the account was initialized, false otherwise.
    #[cfg(not(tarpaulin_include))]
    pub fn process_init_if_needed(
        account_loader_fee_recipients: &mut AccountLoader<FeeRecipients>,
        context_bump: u8,
        folio: &Pubkey,
    ) -> Result<bool> {
        let account_info_fee_recipients = account_loader_fee_recipients.to_account_info();

        let data = account_info_fee_recipients.try_borrow_mut_data()?;
        let mut disc_bytes = [0u8; 8];
        disc_bytes.copy_from_slice(&data[..8]);

        let discriminator = u64::from_le_bytes(disc_bytes);

        drop(data);

        if discriminator == 0 {
            // Not initialized yet
            let fee_recipients = &mut account_loader_fee_recipients.load_init()?;
            fee_recipients.bump = context_bump;
            fee_recipients.folio = *folio;
            fee_recipients.distribution_index = 0;
            fee_recipients.fee_recipients = [FeeRecipient::default(); MAX_FEE_RECIPIENTS];

            return Ok(true);
        } else {
            let account_bump = account_loader_fee_recipients.load()?.bump;
            check_condition!(account_bump == context_bump, InvalidBump);
        }

        Ok(false)
    }

    /// Update the fee recipients list.
    ///
    /// # Arguments
    /// * `fee_recipients_to_add` - The fee recipients to add.
    /// * `fee_recipients_to_remove` - The fee recipients to remove.
    pub fn update_fee_recipients(
        &mut self,
        fee_recipients_to_add: Vec<FeeRecipient>,
        fee_recipients_to_remove: Vec<Pubkey>,
    ) -> Result<()> {
        let mut new_recipients = [FeeRecipient::default(); MAX_FEE_RECIPIENTS];
        let mut add_index = 0;

        // Filter out the default pubkey fee recipients as well as the fee recipients to remove
        for fee_recipient in self.fee_recipients.iter() {
            if !fee_recipients_to_remove.contains(&fee_recipient.recipient)
                && fee_recipient.recipient != Pubkey::default()
            {
                new_recipients[add_index] = *fee_recipient;
                add_index += 1;
            }
        }

        // Filter out fee recipients to add that are in fee recipients to remove
        let mut filtered_fee_recipients_to_add: Vec<FeeRecipient> = vec![];
        for fee_recipient_to_add in fee_recipients_to_add {
            if !fee_recipients_to_remove.contains(&fee_recipient_to_add.recipient) {
                filtered_fee_recipients_to_add.push(fee_recipient_to_add);
            }
        }

        // Add the filtered fee recipients to add to the new recipients list
        for new_recipient in filtered_fee_recipients_to_add {
            check_condition!(add_index < MAX_FEE_RECIPIENTS, InvalidFeeRecipientCount);
            new_recipients[add_index] = new_recipient;
            add_index += 1;

            emit!(FeeRecipientSet {
                recipient: new_recipient.recipient,
                portion: new_recipient.portion,
            });
        }

        self.fee_recipients = new_recipients;

        self.validate_fee_recipient_total_portions_and_check_for_duplicates()
    }

    /// Validate the fee recipient total portions.
    /// Total portions must be 100% (in D18).
    /// And validates there are no duplicate recipients.
    pub fn validate_fee_recipient_total_portions_and_check_for_duplicates(&self) -> Result<()> {
        check_condition!(
            self.fee_recipients.iter().map(|r| r.portion).sum::<u128>()
                == MAX_FEE_RECIPIENTS_PORTION,
            InvalidFeeRecipientPortion
        );

        let mut seen = BTreeSet::new();
        if !self
            .fee_recipients
            .iter()
            .filter(|r| r.recipient != Pubkey::default())
            .map(|r| r.recipient)
            .all(|pubkey| seen.insert(pubkey))
        {
            return err!(ErrorCode::InvalidFeeRecipientContainsDuplicates);
        }

        Ok(())
    }

    /// Check if the fee recipients are empty.
    ///
    /// # Returns
    /// * `bool` - True if the fee recipients are empty, false otherwise.
    pub fn is_empty(&self) -> bool {
        let default_pubkey = Pubkey::default();

        self.fee_recipients
            .iter()
            .all(|r| r.recipient == default_pubkey)
    }
}
