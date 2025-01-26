use crate::events::FeeRecipientSet;
use crate::state::FeeRecipients;
use anchor_lang::prelude::*;
use shared::constants::D9;
use shared::errors::ErrorCode;
use shared::{check_condition, constants::MAX_FEE_RECIPIENTS, structs::FeeRecipient};

impl FeeRecipients {
    pub fn process_init_if_needed(
        account_loader_fee_recipients: &mut AccountLoader<FeeRecipients>,
        context_bump: u8,
        folio: &Pubkey,
    ) -> Result<()> {
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
        } else {
            let account_bump = account_loader_fee_recipients.load()?.bump;
            check_condition!(account_bump == context_bump, InvalidBump);
        }

        Ok(())
    }

    pub fn update_fee_recipients(
        &mut self,
        fee_recipients_to_add: Vec<FeeRecipient>,
        fee_recipients_to_remove: Vec<Pubkey>,
    ) -> Result<()> {
        let mut new_recipients = [FeeRecipient::default(); MAX_FEE_RECIPIENTS];
        let mut add_index = 0;

        for fee_recipient in self.fee_recipients.iter() {
            if !fee_recipients_to_remove.contains(&fee_recipient.receiver)
                && fee_recipient.receiver != Pubkey::default()
            {
                new_recipients[add_index] = *fee_recipient;
                add_index += 1;
            }
        }

        for new_recipient in fee_recipients_to_add {
            check_condition!(add_index < MAX_FEE_RECIPIENTS, InvalidFeeRecipientCount);
            new_recipients[add_index] = new_recipient;
            add_index += 1;

            emit!(FeeRecipientSet {
                recipient: new_recipient.receiver,
                portion: new_recipient.portion,
            });
        }

        self.fee_recipients = new_recipients;

        self.validate_fee_recipient_total_portions()
    }

    pub fn validate_fee_recipient_total_portions(&self) -> Result<()> {
        check_condition!(
            self.fee_recipients
                .iter()
                .map(|r| r.portion as u128)
                .sum::<u128>()
                == D9,
            InvalidFeeRecipientPortion
        );

        Ok(())
    }
}
