use crate::state::FolioFeeRecipients;
use anchor_lang::prelude::*;
use shared::constants::PRECISION_FACTOR;
use shared::errors::ErrorCode;
use shared::{check_condition, constants::MAX_FEE_RECIPIENTS, structs::FeeRecipient};

impl FolioFeeRecipients {
    pub fn process_init_if_needed(
        account_loader_folio_fee_recipients: &mut AccountLoader<FolioFeeRecipients>,
        context_bump: u8,
        folio: &Pubkey,
    ) -> Result<()> {
        let account_info_fee_recipients = account_loader_folio_fee_recipients.to_account_info();

        let data = account_info_fee_recipients.try_borrow_mut_data()?;
        let mut disc_bytes = [0u8; 8];
        disc_bytes.copy_from_slice(&data[..8]);

        let discriminator = u64::from_le_bytes(disc_bytes);

        drop(data);

        if discriminator == 0 {
            // Not initialized yet
            let folio_fee_recipients = &mut account_loader_folio_fee_recipients.load_init()?;
            folio_fee_recipients.bump = context_bump;
            folio_fee_recipients.folio = *folio;
            folio_fee_recipients.fee_recipients = [FeeRecipient::default(); MAX_FEE_RECIPIENTS];
        } else {
            let account_bump = account_loader_folio_fee_recipients.load()?.bump;
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
        }

        self.fee_recipients = new_recipients;

        self.validate_fee_recipient_total_shares()
    }

    pub fn validate_fee_recipient_total_shares(&self) -> Result<()> {
        check_condition!(
            self.fee_recipients.iter().map(|r| r.share).sum::<u64>() == PRECISION_FACTOR,
            InvalidFeeRecipientShares
        );

        Ok(())
    }
}
