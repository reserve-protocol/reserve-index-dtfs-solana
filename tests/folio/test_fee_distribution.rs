#[cfg(test)]
mod tests {
    use anchor_lang::prelude::Pubkey;
    use folio::state::FeeDistribution;
    use folio::utils::structs::FeeRecipient;
    use shared::constants::MAX_FEE_RECIPIENTS;

    #[test]
    fn test_is_fully_distributed() {
        let mut fee_distribution = FeeDistribution {
            fee_recipients_state: [FeeRecipient::default(); MAX_FEE_RECIPIENTS],
            ..Default::default()
        };

        assert!(fee_distribution.is_fully_distributed());

        fee_distribution.fee_recipients_state[0].receiver = Pubkey::new_unique();
        assert!(!fee_distribution.is_fully_distributed());

        fee_distribution.fee_recipients_state[1].receiver = Pubkey::new_unique();
        assert!(!fee_distribution.is_fully_distributed());
    }
}
