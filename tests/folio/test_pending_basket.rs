#[cfg(test)]
mod tests {
    use anchor_lang::prelude::Pubkey;
    use folio::state::PendingBasket;
    use shared::constants::PendingBasketType;
    use shared::errors::ErrorCode;
    use shared::structs::TokenAmount;

    #[test]
    fn test_add_token_amounts_new_mint() {
        let mut pending = PendingBasket::default();
        let token = TokenAmount {
            mint: Pubkey::new_unique(),
            amount_for_minting: 100,
            amount_for_redeeming: 0,
        };

        let result =
            pending.add_token_amounts_to_folio(&vec![token], true, PendingBasketType::MintProcess);

        assert!(result.is_ok());
        assert_eq!(pending.token_amounts[0], token);
        assert_eq!(pending.token_amounts[1], TokenAmount::default());
    }

    #[test]
    fn test_add_token_amounts_existing_mint() {
        let mut pending = PendingBasket::default();
        let token = TokenAmount {
            mint: Pubkey::new_unique(),
            amount_for_minting: 100,
            amount_for_redeeming: 0,
        };
        pending.token_amounts[0] = token;

        let add_amount = TokenAmount {
            mint: token.mint,
            amount_for_minting: 50,
            amount_for_redeeming: 0,
        };

        let result = pending.add_token_amounts_to_folio(
            &vec![add_amount],
            true,
            PendingBasketType::MintProcess,
        );

        assert!(result.is_ok());
        assert_eq!(pending.token_amounts[0].amount_for_minting, 150);
    }

    #[test]
    fn test_add_token_amounts_exceed_max() {
        let mut pending = PendingBasket::default();
        let tokens: Vec<TokenAmount> = (0..65)
            .map(|_| TokenAmount {
                mint: Pubkey::new_unique(),
                amount_for_minting: 100,
                amount_for_redeeming: 0,
            })
            .collect();

        let result =
            pending.add_token_amounts_to_folio(&tokens, true, PendingBasketType::MintProcess);

        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err(),
            ErrorCode::InvalidAddedTokenMints.into()
        );
    }

    #[test]
    fn test_remove_token_amounts_existing() {
        let mut pending = PendingBasket::default();
        let token = TokenAmount {
            mint: Pubkey::new_unique(),
            amount_for_minting: 100,
            amount_for_redeeming: 0,
        };
        pending.token_amounts[0] = token;

        let remove_amount = TokenAmount {
            mint: token.mint,
            amount_for_minting: 50,
            amount_for_redeeming: 0,
        };

        let result = pending.remove_token_amounts_from_folio(
            &vec![remove_amount],
            true,
            PendingBasketType::MintProcess,
        );

        assert!(result.is_ok());
        assert_eq!(pending.token_amounts[0].amount_for_minting, 50);
    }

    #[test]
    fn test_remove_token_amounts_insufficient_balance() {
        let mut pending = PendingBasket::default();
        let token = TokenAmount {
            mint: Pubkey::new_unique(),
            amount_for_minting: 50,
            amount_for_redeeming: 0,
        };
        pending.token_amounts[0] = token;

        let remove_amount = TokenAmount {
            mint: token.mint,
            amount_for_minting: 100,
            amount_for_redeeming: 0,
        };

        let result = pending.remove_token_amounts_from_folio(
            &vec![remove_amount],
            true,
            PendingBasketType::MintProcess,
        );

        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err(),
            ErrorCode::InvalidShareAmountProvided.into()
        );
    }

    #[test]
    fn test_remove_non_existent_mint_with_validation() {
        let mut pending = PendingBasket::default();
        let remove_amount = TokenAmount {
            mint: Pubkey::new_unique(),
            amount_for_minting: 100,
            amount_for_redeeming: 0,
        };

        let result = pending.remove_token_amounts_from_folio(
            &vec![remove_amount],
            true,
            PendingBasketType::MintProcess,
        );

        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err(),
            ErrorCode::InvalidAddedTokenMints.into()
        );
    }

    #[test]
    fn test_remove_non_existent_mint_without_validation() {
        let mut pending = PendingBasket::default();
        let remove_amount = TokenAmount {
            mint: Pubkey::new_unique(),
            amount_for_minting: 100,
            amount_for_redeeming: 0,
        };

        let result = pending.remove_token_amounts_from_folio(
            &vec![remove_amount],
            false,
            PendingBasketType::MintProcess,
        );

        assert!(result.is_ok());
    }

    #[test]
    fn test_reorder_token_amounts() {
        let mut pending = PendingBasket::default();
        let token1 = TokenAmount {
            mint: Pubkey::new_unique(),
            amount_for_minting: 100,
            amount_for_redeeming: 0,
        };
        let token2 = TokenAmount {
            mint: Pubkey::new_unique(),
            amount_for_minting: 200,
            amount_for_redeeming: 0,
        };
        pending.token_amounts[0] = token1;
        pending.token_amounts[1] = token2;

        let ordering = vec![token2, token1];
        let result = pending.reorder_token_amounts(&ordering);

        assert!(result.is_ok());
        assert_eq!(pending.token_amounts[0], token2);
        assert_eq!(pending.token_amounts[1], token1);
    }

    #[test]
    fn test_add_token_amounts_cant_add_new_mints() {
        let mut pending = PendingBasket::default();
        let token = TokenAmount {
            mint: Pubkey::new_unique(),
            amount_for_minting: 100,
            amount_for_redeeming: 0,
        };

        let result =
            pending.add_token_amounts_to_folio(&vec![token], false, PendingBasketType::MintProcess);

        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err(),
            ErrorCode::InvalidAddedTokenMints.into()
        );
    }
}
