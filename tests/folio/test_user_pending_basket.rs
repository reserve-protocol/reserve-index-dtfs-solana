//! Tests for the UserPendingBasket state

#[cfg(test)]
mod tests {
    use anchor_lang::prelude::Pubkey;
    use folio::state::UserPendingBasket;
    use folio::utils::structs::TokenAmount;
    use folio::utils::FolioTokenAmount;
    use shared::constants::{PendingBasketType, MAX_USER_PENDING_BASKET_TOKEN_AMOUNTS};
    use shared::errors::ErrorCode;
    use shared::utils::Decimal;

    #[test]
    fn test_add_token_amounts_new_mint() {
        let mut pending = UserPendingBasket::default();
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
        let mut pending = UserPendingBasket::default();
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

    // #[test]
    // fn test_add_token_amounts_exceed_max() {
    //     let mut pending = UserPendingBasket::default();
    //     let tokens: Vec<TokenAmount> = (0..65)
    //         .map(|_| TokenAmount {
    //             mint: Pubkey::new_unique(),
    //             amount_for_minting: 100,
    //             amount_for_redeeming: 0,
    //         })
    //         .collect();

    //     let result =
    //         pending.add_token_amounts_to_folio(&tokens, true, PendingBasketType::MintProcess);

    //     assert!(result.is_err());
    //     assert_eq!(
    //         result.unwrap_err(),
    //         ErrorCode::InvalidAddedTokenMints.into()
    //     );
    // }

    #[test]
    fn test_add_token_amounts_cant_add_new_mints() {
        let mut pending = UserPendingBasket::default();
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

    #[test]
    fn test_add_token_amounts_new_mint_redeem() {
        let mut pending = UserPendingBasket::default();
        let token = TokenAmount {
            mint: Pubkey::new_unique(),
            amount_for_minting: 0,
            amount_for_redeeming: 100,
        };

        let result = pending.add_token_amounts_to_folio(
            &vec![token],
            true,
            PendingBasketType::RedeemProcess,
        );

        assert!(result.is_ok());
        assert_eq!(pending.token_amounts[0], token);
        assert_eq!(pending.token_amounts[1], TokenAmount::default());
    }

    #[test]
    fn test_add_token_amounts_existing_mint_redeem() {
        let mut pending = UserPendingBasket::default();
        let token = TokenAmount {
            mint: Pubkey::new_unique(),
            amount_for_minting: 0,
            amount_for_redeeming: 100,
        };
        pending.token_amounts[0] = token;

        let add_amount = TokenAmount {
            mint: token.mint,
            amount_for_minting: 0,
            amount_for_redeeming: 50,
        };

        let result = pending.add_token_amounts_to_folio(
            &vec![add_amount],
            true,
            PendingBasketType::RedeemProcess,
        );

        assert!(result.is_ok());
        assert_eq!(pending.token_amounts[0].amount_for_redeeming, 150);
    }

    // #[test]
    // fn test_add_token_amounts_exceed_max_redeem() {
    //     let mut pending = UserPendingBasket::default();
    //     let tokens: Vec<TokenAmount> = (0..65)
    //         .map(|_| TokenAmount {
    //             mint: Pubkey::new_unique(),
    //             amount_for_minting: 0,
    //             amount_for_redeeming: 100,
    //         })
    //         .collect();

    //     let result =
    //         pending.add_token_amounts_to_folio(&tokens, true, PendingBasketType::RedeemProcess);

    //     assert!(result.is_err());
    //     assert_eq!(
    //         result.unwrap_err(),
    //         ErrorCode::InvalidAddedTokenMints.into()
    //     );
    // }

    #[test]
    fn test_add_token_amounts_cant_add_new_mints_redeem() {
        let mut pending = UserPendingBasket::default();
        let token = TokenAmount {
            mint: Pubkey::new_unique(),
            amount_for_minting: 0,
            amount_for_redeeming: 100,
        };

        let result = pending.add_token_amounts_to_folio(
            &vec![token],
            false,
            PendingBasketType::RedeemProcess,
        );

        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err(),
            ErrorCode::InvalidAddedTokenMints.into()
        );
    }

    #[test]
    fn test_remove_token_amounts_existing() {
        let mut pending = UserPendingBasket::default();
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
    fn test_remove_token_amounts_existing_redeem() {
        let mut pending = UserPendingBasket::default();
        let token = TokenAmount {
            mint: Pubkey::new_unique(),
            amount_for_minting: 0,
            amount_for_redeeming: 100,
        };
        pending.token_amounts[0] = token;

        let remove_amount = TokenAmount {
            mint: token.mint,
            amount_for_minting: 0,
            amount_for_redeeming: 50,
        };

        let result = pending.remove_token_amounts_from_folio(
            &vec![remove_amount],
            true,
            PendingBasketType::RedeemProcess,
        );

        assert!(result.is_ok());
        assert_eq!(pending.token_amounts[0].amount_for_redeeming, 50);
    }

    #[test]
    fn test_remove_token_amounts_insufficient_balance() {
        let mut pending = UserPendingBasket::default();
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
        let mut pending = UserPendingBasket::default();
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
            ErrorCode::InvalidRemovedTokenMints.into()
        );
    }

    #[test]
    fn test_remove_non_existent_mint_without_validation() {
        let mut pending = UserPendingBasket::default();
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
    fn test_is_empty() {
        // Test completely empty basket
        let basket = UserPendingBasket {
            token_amounts: [TokenAmount::default(); MAX_USER_PENDING_BASKET_TOKEN_AMOUNTS],
            ..UserPendingBasket::default()
        };
        assert!(basket.is_empty());

        // Test basket with minting amount
        let mut basket_with_mint = UserPendingBasket {
            token_amounts: [TokenAmount::default(); MAX_USER_PENDING_BASKET_TOKEN_AMOUNTS],
            ..UserPendingBasket::default()
        };
        basket_with_mint.token_amounts[0].amount_for_minting = 100;
        assert!(!basket_with_mint.is_empty());

        // Test basket with redeeming amount
        let mut basket_with_redeem = UserPendingBasket {
            token_amounts: [TokenAmount::default(); MAX_USER_PENDING_BASKET_TOKEN_AMOUNTS],
            ..UserPendingBasket::default()
        };
        basket_with_redeem.token_amounts[0].amount_for_redeeming = 100;
        assert!(!basket_with_redeem.is_empty());

        // Test basket with both amounts
        let mut basket_with_both = UserPendingBasket {
            token_amounts: [TokenAmount::default(); MAX_USER_PENDING_BASKET_TOKEN_AMOUNTS],
            ..UserPendingBasket::default()
        };
        basket_with_both.token_amounts[0].amount_for_minting = 100;
        basket_with_both.token_amounts[0].amount_for_redeeming = 100;
        assert!(!basket_with_both.is_empty());

        // Test basket with amounts in different slots
        let mut basket_multiple_slots = UserPendingBasket {
            token_amounts: [TokenAmount::default(); MAX_USER_PENDING_BASKET_TOKEN_AMOUNTS],
            ..UserPendingBasket::default()
        };
        basket_multiple_slots.token_amounts[0].amount_for_minting = 100;
        basket_multiple_slots.token_amounts[1].amount_for_redeeming = 100;
        assert!(!basket_multiple_slots.is_empty());
    }

    #[test]
    fn test_reset() {
        // Setup basket with various amounts
        let mut basket = UserPendingBasket {
            token_amounts: [TokenAmount::default(); MAX_USER_PENDING_BASKET_TOKEN_AMOUNTS],
            ..UserPendingBasket::default()
        };

        // Add some mints and amounts
        basket.token_amounts[0].mint = Pubkey::new_unique();
        basket.token_amounts[0].amount_for_minting = 100;
        basket.token_amounts[0].amount_for_redeeming = 200;

        basket.token_amounts[1].mint = Pubkey::new_unique();
        basket.token_amounts[1].amount_for_minting = 300;
        basket.token_amounts[1].amount_for_redeeming = 400;

        // Reset the basket
        basket.reset();

        // Verify everything is reset to default
        assert!(basket.is_empty());
        for token_amount in basket.token_amounts.iter() {
            assert_eq!(token_amount.mint, Pubkey::default());
            assert_eq!(token_amount.amount_for_minting, 0);
            assert_eq!(token_amount.amount_for_redeeming, 0);
        }
    }

    #[test]
    fn test_to_assets_for_minting() {
        let mut user_amount = TokenAmount {
            mint: Pubkey::new_unique(),
            amount_for_minting: 1_000_000,
            amount_for_redeeming: 0,
        };

        let mut folio_amount = FolioTokenAmount {
            mint: user_amount.mint,
            amount: 100_000_000,
        };

        // Total supply: 100 tokens
        // Folio balance: 100 tokens
        // Shares to mint: 1 tokens
        let decimal_total_supply = Decimal::from_token_amount(100_000_000u128).unwrap();
        let decimal_folio_balance = Decimal::from_token_amount(100_000_000u128).unwrap();
        let shares = 1_000_000; // D9

        let result = UserPendingBasket::to_assets_for_minting(
            &mut user_amount,
            &mut folio_amount,
            &decimal_total_supply,
            &decimal_folio_balance,
            shares,
        );

        assert!(result.is_ok());

        assert_eq!(user_amount.amount_for_minting, 0);
        assert_eq!(folio_amount.amount, 101_000_000);
    }

    #[test]
    fn test_to_assets_for_minting_insufficient_shares() {
        let mut user_amount = TokenAmount {
            mint: Pubkey::new_unique(),
            amount_for_minting: 100_000,
            amount_for_redeeming: 0,
        };

        let mut related_mint = FolioTokenAmount {
            mint: user_amount.mint,
            amount: 100_000,
        };

        let decimal_total_supply = Decimal::from_token_amount(100_000_000u128).unwrap();
        let decimal_folio_balance = Decimal::from_token_amount(50_000_000u128).unwrap();
        let shares = 1_000_000; // Trying to mint more shares than possible

        let result = UserPendingBasket::to_assets_for_minting(
            &mut user_amount,
            &mut related_mint,
            &decimal_total_supply,
            &decimal_folio_balance,
            shares,
        );

        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err(),
            ErrorCode::InvalidShareAmountProvided.into()
        );
    }

    #[test]
    fn test_to_assets_for_minting_max_values() {
        let mut user_amount = TokenAmount {
            mint: Pubkey::new_unique(),
            amount_for_minting: u64::MAX,
            amount_for_redeeming: 0,
        };

        let mut related_mint = FolioTokenAmount {
            mint: user_amount.mint,
            amount: 0,
        };

        let decimal_total_supply = Decimal::from_token_amount(u64::MAX as u128).unwrap();
        let decimal_folio_balance = Decimal::from_token_amount(u64::MAX as u128).unwrap();
        let shares = u64::MAX;

        let result = UserPendingBasket::to_assets_for_minting(
            &mut user_amount,
            &mut related_mint,
            &decimal_total_supply,
            &decimal_folio_balance,
            shares,
        );

        assert!(result.is_ok());
    }

    #[test]
    fn test_to_assets_for_minting_zero_shares() {
        let mut user_amount = TokenAmount {
            mint: Pubkey::new_unique(),
            amount_for_minting: 1_000_000,
            amount_for_redeeming: 0,
        };

        let mut related_mint = FolioTokenAmount {
            mint: user_amount.mint,
            amount: 1_000_000,
        };

        let decimal_total_supply = Decimal::from_token_amount(100_000_000u128).unwrap();
        let decimal_folio_balance = Decimal::from_token_amount(50_000_000u128).unwrap();
        let shares = 0;

        let result = UserPendingBasket::to_assets_for_minting(
            &mut user_amount,
            &mut related_mint,
            &decimal_total_supply,
            &decimal_folio_balance,
            shares,
        );

        assert!(result.is_ok());
        assert_eq!(user_amount.amount_for_minting, 1_000_000); // Should remain unchanged
        assert_eq!(related_mint.amount, 1_000_000);
    }

    #[test]
    fn test_to_assets_for_minting_empty_folio() {
        let mut user_amount = TokenAmount {
            mint: Pubkey::new_unique(),
            amount_for_minting: 1_000_000,
            amount_for_redeeming: 0,
        };

        let mut related_mint = FolioTokenAmount {
            mint: user_amount.mint,
            amount: 1_000_000,
        };

        let decimal_total_supply = Decimal::from_token_amount(0u128).unwrap();
        let decimal_folio_balance = Decimal::from_token_amount(0u128).unwrap();
        let shares = 1_000_000;

        let result = UserPendingBasket::to_assets_for_minting(
            &mut user_amount,
            &mut related_mint,
            &decimal_total_supply,
            &decimal_folio_balance,
            shares,
        );

        assert!(result.is_err()); // Should fail due to division by zero
    }

    #[test]
    fn test_to_assets_for_redeeming() {
        let mut user_amount = TokenAmount {
            mint: Pubkey::new_unique(),
            amount_for_minting: 0,
            amount_for_redeeming: 0,
        };

        let mut related_mint = FolioTokenAmount {
            mint: user_amount.mint,
            amount: 20_000_000,
        };

        // Total supply: 100 tokens
        // Folio balance: 50 tokens
        // Shares to redeem: 10 tokens
        let decimal_total_supply = Decimal::from_token_amount(100_000_000u128).unwrap();
        let decimal_folio_balance = Decimal::from_token_amount(50_000_000u128).unwrap();
        let shares = 10_000_000; // D9

        let result = UserPendingBasket::to_assets_for_redeeming(
            &mut user_amount,
            &mut related_mint,
            &decimal_total_supply,
            &decimal_folio_balance,
            shares,
        );

        assert!(result.is_ok());

        // Should receive 5 tokens (10% of 50 tokens)
        assert_eq!(user_amount.amount_for_redeeming, 5_000_000);
        assert_eq!(related_mint.amount, 15_000_000);
    }

    #[test]
    fn test_to_assets_for_redeeming_rounding() {
        let mut user_amount = TokenAmount {
            mint: Pubkey::new_unique(),
            amount_for_minting: 0,
            amount_for_redeeming: 0,
        };

        let mut related_mint = FolioTokenAmount {
            mint: user_amount.mint,
            amount: 100_000_000,
        };

        let decimal_total_supply = Decimal::from_token_amount(3_000_000u128).unwrap();
        let decimal_folio_balance = Decimal::from_token_amount(1_000_000u128).unwrap();
        let shares = 1_000_000; // D9

        let result = UserPendingBasket::to_assets_for_redeeming(
            &mut user_amount,
            &mut related_mint,
            &decimal_total_supply,
            &decimal_folio_balance,
            shares,
        );

        assert!(result.is_ok());

        assert_eq!(user_amount.amount_for_redeeming, 333_333);
        assert_eq!(related_mint.amount, 99666667);
    }

    #[test]
    fn test_to_assets_for_redeeming_empty_folio() {
        let mut user_amount = TokenAmount {
            mint: Pubkey::new_unique(),
            amount_for_minting: 0,
            amount_for_redeeming: 0,
        };

        let mut related_mint = FolioTokenAmount {
            mint: user_amount.mint,
            amount: 0,
        };

        let decimal_total_supply = Decimal::from_token_amount(0u128).unwrap();
        let decimal_folio_balance = Decimal::from_token_amount(0u128).unwrap();
        let shares = 1_000_000;

        let result = UserPendingBasket::to_assets_for_redeeming(
            &mut user_amount,
            &mut related_mint,
            &decimal_total_supply,
            &decimal_folio_balance,
            shares,
        );

        assert!(result.is_err()); // Should fail due to division by zero
    }

    #[test]
    fn test_to_assets_for_redeeming_zero_shares() {
        let mut user_amount = TokenAmount {
            mint: Pubkey::new_unique(),
            amount_for_minting: 0,
            amount_for_redeeming: 1_000_000,
        };

        let mut related_mint = FolioTokenAmount {
            mint: user_amount.mint,
            amount: 100_000_000,
        };

        let decimal_total_supply = Decimal::from_token_amount(100_000_000u128).unwrap();
        let decimal_folio_balance = Decimal::from_token_amount(50_000_000u128).unwrap();
        let shares = 0;

        let result = UserPendingBasket::to_assets_for_redeeming(
            &mut user_amount,
            &mut related_mint,
            &decimal_total_supply,
            &decimal_folio_balance,
            shares,
        );

        assert!(result.is_ok());
        assert_eq!(user_amount.amount_for_redeeming, 1_000_000); // Should remain unchanged
        assert_eq!(related_mint.amount, 100000000);
    }

    #[test]
    fn test_to_assets_mint_redeem_interaction() {
        let mut user_amount = TokenAmount {
            mint: Pubkey::new_unique(),
            amount_for_minting: 1_000_000,
            amount_for_redeeming: 500_000,
        };

        let mut related_mint = FolioTokenAmount {
            mint: user_amount.mint,
            amount: 1_000_000,
        };

        let decimal_total_supply = Decimal::from_token_amount(100_000_000u128).unwrap();
        let decimal_folio_balance = Decimal::from_token_amount(50_000_000u128).unwrap();
        let shares = 1_000_000;

        // Test minting doesn't affect redeeming amounts
        let result = UserPendingBasket::to_assets_for_minting(
            &mut user_amount,
            &mut related_mint,
            &decimal_total_supply,
            &decimal_folio_balance,
            shares,
        );

        assert!(result.is_ok());
        assert_eq!(user_amount.amount_for_redeeming, 500_000); // Should remain unchanged
        assert_eq!(user_amount.amount_for_minting, 500_000); // Is reduced to 1/2
        assert_eq!(related_mint.amount, 1_500_000);
    }
}
