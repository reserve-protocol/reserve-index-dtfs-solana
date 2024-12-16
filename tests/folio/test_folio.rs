#[cfg(test)]
mod tests {
    use crate::fixtures::fixtures::TestFixture;

    use super::*;
    use anchor_lang::{prelude::*, solana_program::bpf_loader_upgradeable};
    use folio::state::{Folio, ProgramRegistrar};
    use shared::errors::ErrorCode;
    use shared::{constants::PRECISION_FACTOR, structs::FeeRecipient};

    /*
    This is the only test done with accounts, because of the complexity of mocking / doing fixtures for accounts.
     */
    #[test]
    fn test_validate_folio_program_for_init() {
        let mut fixture = TestFixture::<ProgramRegistrar>::new();
        fixture.setup();

        let dtf_program = fixture.get_dtf_program().clone();

        let program_registrar = fixture.get_program_registrar_mut();
        program_registrar
            .add_to_registrar(&mut vec![dtf_program.key()])
            .unwrap();

        assert!(Folio::validate_folio_program_for_init(program_registrar, &dtf_program).is_ok());
    }

    #[test]
    fn test_update_fee_recipients_add_new() {
        let mut folio = Folio::default();
        let recipient1 = FeeRecipient {
            receiver: Pubkey::new_unique(),
            share: PRECISION_FACTOR,
        };

        let result = folio.update_fee_recipients(vec![recipient1], vec![]);

        assert!(result.is_ok());
        assert_eq!(folio.fee_recipients[0], recipient1);
        assert_eq!(folio.fee_recipients[1], FeeRecipient::default());
    }

    #[test]
    fn test_update_fee_recipients_remove_existing_is_last() {
        let mut folio = Folio::default();
        let recipient1 = FeeRecipient {
            receiver: Pubkey::new_unique(),
            share: PRECISION_FACTOR,
        };
        folio.fee_recipients[0] = recipient1;

        let result = folio.update_fee_recipients(vec![], vec![recipient1.receiver]);

        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err(),
            ErrorCode::InvalidFeeRecipientShares.into()
        );
    }

    #[test]
    fn test_update_fee_recipients_add_and_remove() {
        let mut folio = Folio::default();
        let old_recipient = FeeRecipient {
            receiver: Pubkey::new_unique(),
            share: PRECISION_FACTOR / 2,
        };
        let new_recipient = FeeRecipient {
            receiver: Pubkey::new_unique(),
            share: PRECISION_FACTOR,
        };
        folio.fee_recipients[0] = old_recipient;

        let result = folio.update_fee_recipients(vec![new_recipient], vec![old_recipient.receiver]);

        assert!(result.is_ok());
        assert_eq!(folio.fee_recipients[0], new_recipient);
        assert_eq!(folio.fee_recipients[1], FeeRecipient::default());
    }

    #[test]
    fn test_update_fee_recipients_exceed_max() {
        let mut folio = Folio::default();
        let recipients: Vec<FeeRecipient> = (0..65)
            .map(|_| FeeRecipient {
                receiver: Pubkey::new_unique(),
                share: PRECISION_FACTOR / 65,
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
        let mut folio = Folio::default();
        let recipient1 = FeeRecipient {
            receiver: Pubkey::new_unique(),
            share: PRECISION_FACTOR / 2,
        };
        let recipient2 = FeeRecipient {
            receiver: Pubkey::new_unique(),
            share: PRECISION_FACTOR / 2,
        };
        folio.fee_recipients[0] = recipient1;
        folio.fee_recipients[1] = recipient2;

        let new_recipient = FeeRecipient {
            receiver: Pubkey::new_unique(),
            share: PRECISION_FACTOR / 2,
        };

        let result = folio.update_fee_recipients(vec![new_recipient], vec![recipient1.receiver]);

        assert!(result.is_ok());
        assert_eq!(folio.fee_recipients[0], recipient2);
        assert_eq!(folio.fee_recipients[1], new_recipient);
    }

    #[test]
    fn test_update_fee_recipients_ignore_non_existent_remove() {
        let mut folio = Folio::default();
        let recipient = FeeRecipient {
            receiver: Pubkey::new_unique(),
            share: PRECISION_FACTOR,
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
        let mut folio = Folio::default();
        let recipient = FeeRecipient {
            receiver: Pubkey::default(),
            share: PRECISION_FACTOR,
        };
        folio.fee_recipients[0] = recipient;

        let new_recipient = FeeRecipient {
            receiver: Pubkey::new_unique(),
            share: PRECISION_FACTOR,
        };

        let result = folio.update_fee_recipients(vec![new_recipient], vec![]);

        assert!(result.is_ok());
        assert_eq!(folio.fee_recipients[0], new_recipient);
    }

    #[test]
    fn test_validate_fee_recipient_total_shares_success() {
        let mut folio = Folio::default();
        folio.fee_recipients[0] = FeeRecipient {
            receiver: Pubkey::new_unique(),
            share: PRECISION_FACTOR / 2,
        };
        folio.fee_recipients[1] = FeeRecipient {
            receiver: Pubkey::new_unique(),
            share: PRECISION_FACTOR / 2,
        };

        let result = folio.validate_fee_recipient_total_shares();
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_fee_recipient_total_shares_failure() {
        let mut folio = Folio::default();
        folio.fee_recipients[0] = FeeRecipient {
            receiver: Pubkey::new_unique(),
            share: PRECISION_FACTOR / 4,
        };
        folio.fee_recipients[1] = FeeRecipient {
            receiver: Pubkey::new_unique(),
            share: PRECISION_FACTOR / 4,
        };

        let result = folio.validate_fee_recipient_total_shares();
        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err(),
            ErrorCode::InvalidFeeRecipientShares.into()
        );
    }
}
