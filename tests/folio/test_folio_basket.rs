#[cfg(test)]
mod tests {
    use anchor_lang::prelude::Pubkey;
    use folio::state::FolioBasket;
    use shared::{
        constants::{PendingBasketType, MAX_FOLIO_TOKEN_AMOUNTS},
        errors::ErrorCode::*,
        structs::TokenAmount,
    };

    fn setup_folio_basket() -> FolioBasket {
        let mut basket = FolioBasket {
            folio: Pubkey::new_unique(),
            token_amounts: [TokenAmount::default(); MAX_FOLIO_TOKEN_AMOUNTS],
            ..Default::default()
        };
        basket.token_amounts[0].mint = Pubkey::new_unique();
        basket.token_amounts[1].mint = Pubkey::new_unique();
        basket
    }

    #[test]
    fn test_add_tokens_to_basket() {
        let mut basket = setup_folio_basket();
        let new_mint = Pubkey::new_unique();

        basket.add_tokens_to_basket(&vec![new_mint]).unwrap();
        assert_eq!(basket.token_amounts[2].mint, new_mint);

        let duplicate_result = basket.add_tokens_to_basket(&vec![new_mint]);
        assert!(duplicate_result.is_ok());

        let mut full_mints = Vec::new();
        for _ in 0..MAX_FOLIO_TOKEN_AMOUNTS {
            full_mints.push(Pubkey::new_unique());
        }
        let error = basket.add_tokens_to_basket(&full_mints);
        assert_eq!(error.unwrap_err(), MaxNumberOfTokensReached.into());
    }

    #[test]
    fn test_remove_tokens_from_basket() {
        let mut basket = setup_folio_basket();
        let mint_to_remove = basket.token_amounts[0].mint;

        basket
            .remove_tokens_from_basket(&vec![mint_to_remove])
            .unwrap();
        assert_eq!(basket.token_amounts[0].mint, Pubkey::default());
        assert_eq!(basket.token_amounts[0].amount_for_minting, 0);
        assert_eq!(basket.token_amounts[0].amount_for_redeeming, 0);

        let invalid_mint = Pubkey::new_unique();
        let error = basket.remove_tokens_from_basket(&vec![invalid_mint]);
        assert_eq!(error.unwrap_err(), InvalidRemovedTokenMints.into());
    }

    #[test]
    fn test_add_token_amounts_to_basket() {
        let mut basket = setup_folio_basket();
        let mint = basket.token_amounts[0].mint;

        let token_amounts = vec![TokenAmount {
            mint,
            amount_for_minting: 100,
            amount_for_redeeming: 50,
        }];

        basket
            .add_token_amounts_to_basket(&token_amounts, PendingBasketType::MintProcess)
            .unwrap();
        assert_eq!(basket.token_amounts[0].amount_for_minting, 100);

        basket
            .add_token_amounts_to_basket(&token_amounts, PendingBasketType::RedeemProcess)
            .unwrap();
        assert_eq!(basket.token_amounts[0].amount_for_redeeming, 50);

        let invalid_mint = Pubkey::new_unique();
        let invalid_amounts = vec![TokenAmount {
            mint: invalid_mint,
            amount_for_minting: 100,
            amount_for_redeeming: 50,
        }];

        let error =
            basket.add_token_amounts_to_basket(&invalid_amounts, PendingBasketType::MintProcess);
        assert_eq!(error.unwrap_err(), InvalidAddedTokenMints.into());
    }

    #[test]
    fn test_remove_token_amounts_from_folio() {
        let mut basket = setup_folio_basket();
        let mint = basket.token_amounts[0].mint;

        basket.token_amounts[0].amount_for_minting = 100;
        basket.token_amounts[0].amount_for_redeeming = 50;

        let token_amounts = vec![TokenAmount {
            mint,
            amount_for_minting: 50,
            amount_for_redeeming: 25,
        }];

        basket
            .remove_token_amounts_from_folio(&token_amounts, true, PendingBasketType::MintProcess)
            .unwrap();
        assert_eq!(basket.token_amounts[0].amount_for_minting, 50);

        basket
            .remove_token_amounts_from_folio(&token_amounts, true, PendingBasketType::RedeemProcess)
            .unwrap();
        assert_eq!(basket.token_amounts[0].amount_for_redeeming, 25);

        let overflow_amounts = vec![TokenAmount {
            mint,
            amount_for_minting: 1000,
            amount_for_redeeming: 1000,
        }];

        let error = basket.remove_token_amounts_from_folio(
            &overflow_amounts,
            true,
            PendingBasketType::MintProcess,
        );
        assert_eq!(error.unwrap_err(), InvalidShareAmountProvided.into());
    }

    #[test]
    fn test_get_clean_token_balance() {
        let token_amounts = TokenAmount {
            mint: Pubkey::new_unique(),
            amount_for_minting: 100,
            amount_for_redeeming: 50,
        };

        let balance = FolioBasket::get_clean_token_balance(1000, &token_amounts).unwrap();
        assert_eq!(balance, 850);

        let error = FolioBasket::get_clean_token_balance(100, &token_amounts);
        assert_eq!(error.unwrap_err(), MathOverflow.into());
    }
}
