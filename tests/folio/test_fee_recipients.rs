//! Tests for the FeeRecipients state

#[cfg(test)]
mod tests {
    use anchor_lang::prelude::Pubkey;
    use folio::state::FeeRecipients;
    use folio::utils::structs::FeeRecipient;
    use shared::errors::ErrorCode;

    const HALF: u128 = 500_000_000_000_000_000;
    const SCALAR: u128 = 1_000_000_000_000_000_000;

    #[test]
    fn test_update_fee_recipients_add_new() {
        let mut folio = FeeRecipients::default();
        let recipient1 = FeeRecipient {
            recipient: Pubkey::new_unique(),
            portion: SCALAR,
        };

        let result = folio.update_fee_recipients(vec![recipient1], vec![]);

        assert!(result.is_ok());
        assert_eq!(folio.fee_recipients[0], recipient1);
        assert_eq!(folio.fee_recipients[1], FeeRecipient::default());
    }

    #[test]
    fn test_update_fee_recipients_remove_existing_is_last() {
        let mut folio = FeeRecipients::default();
        let recipient1 = FeeRecipient {
            recipient: Pubkey::new_unique(),
            portion: SCALAR,
        };
        folio.fee_recipients[0] = recipient1;

        let result = folio.update_fee_recipients(vec![], vec![recipient1.recipient]);

        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err(),
            ErrorCode::InvalidFeeRecipientPortion.into()
        );
    }

    #[test]
    fn test_update_fee_recipients_add_and_remove() {
        let mut folio = FeeRecipients::default();
        let old_recipient = FeeRecipient {
            recipient: Pubkey::new_unique(),
            portion: SCALAR,
        };
        let new_recipient = FeeRecipient {
            recipient: Pubkey::new_unique(),
            portion: SCALAR,
        };
        folio.fee_recipients[0] = old_recipient;

        let result =
            folio.update_fee_recipients(vec![new_recipient], vec![old_recipient.recipient]);

        assert!(result.is_ok());
        assert_eq!(folio.fee_recipients[0], new_recipient);
        assert_eq!(folio.fee_recipients[1], FeeRecipient::default());
    }

    #[test]
    fn test_update_fee_recipients_exceed_max() {
        let mut folio = FeeRecipients::default();
        let recipients: Vec<FeeRecipient> = (0..65)
            .map(|_| FeeRecipient {
                recipient: Pubkey::new_unique(),
                portion: SCALAR.checked_div(65u128).unwrap(),
            })
            .collect();

        let result = folio.update_fee_recipients(recipients, vec![]);

        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err(),
            ErrorCode::InvalidFeeRecipientCount.into()
        );
    }

    #[test]
    fn test_update_fee_recipients_preserve_order() {
        let mut folio = FeeRecipients::default();
        let recipient1 = FeeRecipient {
            recipient: Pubkey::new_unique(),
            portion: HALF,
        };
        let recipient2 = FeeRecipient {
            recipient: Pubkey::new_unique(),
            portion: HALF,
        };
        folio.fee_recipients[0] = recipient1;
        folio.fee_recipients[1] = recipient2;

        let new_recipient = FeeRecipient {
            recipient: Pubkey::new_unique(),
            portion: HALF,
        };

        let result = folio.update_fee_recipients(vec![new_recipient], vec![recipient1.recipient]);

        assert!(result.is_ok());
        assert_eq!(folio.fee_recipients[0], recipient2);
        assert_eq!(folio.fee_recipients[1], new_recipient);
    }

    #[test]
    fn test_update_fee_recipients_ignore_non_existent_remove() {
        let mut folio = FeeRecipients::default();
        let recipient = FeeRecipient {
            recipient: Pubkey::new_unique(),
            portion: SCALAR,
        };
        folio.fee_recipients[0] = recipient;

        let result = folio.update_fee_recipients(
            vec![],
            vec![Pubkey::new_unique()], // Try to remove non-existent recipient
        );

        assert!(result.is_ok());
        assert_eq!(folio.fee_recipients[0], recipient);
    }

    #[test]
    fn test_update_fee_recipients_ignore_default_pubkey() {
        let mut folio = FeeRecipients::default();
        let recipient = FeeRecipient {
            recipient: Pubkey::default(),
            portion: SCALAR,
        };
        folio.fee_recipients[0] = recipient;

        let new_recipient = FeeRecipient {
            recipient: Pubkey::new_unique(),
            portion: SCALAR,
        };

        let result = folio.update_fee_recipients(vec![new_recipient], vec![]);

        assert!(result.is_ok());
        assert_eq!(folio.fee_recipients[0], new_recipient);
    }

    #[test]
    fn test_validate_fee_recipient_total_portions_success() {
        let mut folio = FeeRecipients::default();
        folio.fee_recipients[0] = FeeRecipient {
            recipient: Pubkey::new_unique(),
            portion: HALF,
        };
        folio.fee_recipients[1] = FeeRecipient {
            recipient: Pubkey::new_unique(),
            portion: HALF,
        };

        let result = folio.validate_fee_recipient_total_portions_and_check_for_duplicates();
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_fee_recipient_total_portions_failure() {
        let mut folio = FeeRecipients::default();
        folio.fee_recipients[0] = FeeRecipient {
            recipient: Pubkey::new_unique(),
            portion: SCALAR.checked_div(4u128).unwrap(),
        };
        folio.fee_recipients[1] = FeeRecipient {
            recipient: Pubkey::new_unique(),
            portion: SCALAR.checked_div(4u128).unwrap(),
        };

        let result = folio.validate_fee_recipient_total_portions_and_check_for_duplicates();
        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err(),
            ErrorCode::InvalidFeeRecipientPortion.into()
        );
    }

    #[test]
    fn test_validate_fee_recipient_total_portions_failure_duplicates() {
        let mut folio = FeeRecipients::default();
        folio.fee_recipients[0] = FeeRecipient {
            recipient: Pubkey::new_unique(),
            portion: HALF,
        };
        let recipient2 = Pubkey::new_unique();
        folio.fee_recipients[1] = FeeRecipient {
            recipient: recipient2,
            portion: HALF / 2,
        };
        folio.fee_recipients[2] = FeeRecipient {
            recipient: recipient2,
            portion: HALF / 2,
        };

        let result = folio.validate_fee_recipient_total_portions_and_check_for_duplicates();
        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err(),
            ErrorCode::InvalidFeeRecipientContainsDuplicates.into()
        );
    }
}
