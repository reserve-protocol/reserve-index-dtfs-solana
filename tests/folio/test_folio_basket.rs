//! Tests for the FolioBasket state

#[cfg(test)]
mod tests {
    use anchor_lang::prelude::Pubkey;
    use folio::state::FolioBasket;
    use folio::utils::structs::FolioTokenAmount;
    use folio::utils::FolioTokenBasket;
    use shared::constants::MAX_FOLIO_TOKEN_AMOUNTS;
    use shared::errors::ErrorCode::*;

    fn setup_folio_basket() -> FolioBasket {
        let mut basket = FolioBasket {
            folio: Pubkey::new_unique(),
            basket: FolioTokenBasket {
                token_amounts: [FolioTokenAmount::default(); MAX_FOLIO_TOKEN_AMOUNTS],
            },
            ..Default::default()
        };
        basket.basket.token_amounts[0].mint = Pubkey::new_unique();
        basket.basket.token_amounts[1].mint = Pubkey::new_unique();
        basket
    }

    #[test]
    fn test_add_tokens_to_basket() {
        let mut basket = setup_folio_basket();
        let new_mint = Pubkey::new_unique();

        basket
            .add_tokens_to_basket(&vec![FolioTokenAmount {
                mint: new_mint,
                amount: 100,
            }])
            .unwrap();
        assert_eq!(basket.basket.token_amounts[2].mint, new_mint);
        assert_eq!(basket.basket.token_amounts[2].amount, 100);

        let duplicate_result = basket.add_tokens_to_basket(&vec![FolioTokenAmount {
            mint: new_mint,
            amount: 100,
        }]);
        assert!(duplicate_result.is_ok());

        let mut full_mints = Vec::new();
        for _ in 0..MAX_FOLIO_TOKEN_AMOUNTS {
            full_mints.push(FolioTokenAmount {
                mint: Pubkey::new_unique(),
                amount: 100,
            });
        }
        let error = basket.add_tokens_to_basket(&full_mints);
        assert_eq!(error.unwrap_err(), MaxNumberOfTokensReached.into());
    }

    #[test]
    fn test_remove_token_mint_from_basket() {
        let mut basket = setup_folio_basket();
        let mint_to_remove = basket.basket.token_amounts[0].mint;
        basket.basket.token_amounts[0].amount = 100;

        basket
            .remove_token_mint_from_basket(mint_to_remove)
            .unwrap();
        assert_eq!(basket.basket.token_amounts[0].mint, Pubkey::default());
        assert_eq!(basket.basket.token_amounts[0].amount, 0);

        let invalid_mint = Pubkey::new_unique();
        let error = basket.remove_token_mint_from_basket(invalid_mint);
        assert_eq!(error.unwrap_err(), InvalidRemovedTokenMints.into());
    }

    #[test]
    fn test_get_total_number_of_mints() {
        let mut basket = setup_folio_basket();
        basket.basket.token_amounts[0].mint = Pubkey::default();
        basket.basket.token_amounts[1].mint = Pubkey::default();
        assert_eq!(basket.get_total_number_of_mints(), 0);
        let expected_mints = 10;
        for i in 0..expected_mints {
            basket.basket.token_amounts[i].mint = Pubkey::new_unique();
            basket.basket.token_amounts[i].amount = 100;
        }
        assert_eq!(basket.get_total_number_of_mints(), expected_mints as u8);
    }

    #[test]
    fn test_get_token_amount_in_folio_basket() {
        let mut basket = setup_folio_basket();
        let mint = basket.basket.token_amounts[0].mint;
        basket.basket.token_amounts[0].amount = 100;

        let balance = basket.get_token_amount_in_folio_basket(&mint).unwrap();
        assert_eq!(balance, 100);

        let error = basket.get_token_amount_in_folio_basket(&Pubkey::new_unique());
        assert_eq!(error.unwrap_err(), TokenMintNotInOldFolioBasket.into());
    }
}
