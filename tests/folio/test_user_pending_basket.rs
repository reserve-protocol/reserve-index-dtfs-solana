#[cfg(test)]
mod tests {
    use anchor_lang::prelude::Pubkey;
    use folio::state::UserPendingBasket;
    use folio::utils::structs::TokenAmount;
    use shared::constants::PendingBasketType;
    use shared::errors::ErrorCode;

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

    #[test]
    fn test_add_token_amounts_exceed_max() {
        let mut pending = UserPendingBasket::default();
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
    fn test_reorder_token_amounts() {
        let mut pending = UserPendingBasket::default();
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
    fn test_to_assets_for_minting() {
        let mut user_amount = TokenAmount {
            mint: Pubkey::new_unique(),

            amount_for_minting: 1_000_000,
            amount_for_redeeming: 0,
        };

        let mut folio_amount = TokenAmount {
            mint: user_amount.mint,

            amount_for_minting: 100_000_000,
            amount_for_redeeming: 0,
        };

        // Total supply: 100 tokens
        // Folio balance: 100 tokens
        // Shares to mint: 1 tokens
        let decimal_total_supply = 100_000_000;
        let decimal_folio_balance = 100_000_000;
        let shares = 1_000_000;

        let result = UserPendingBasket::to_assets_for_minting(
            &mut user_amount,
            &mut folio_amount,
            decimal_total_supply,
            decimal_folio_balance,
            shares,
        );

        assert!(result.is_ok());

        assert_eq!(user_amount.amount_for_minting, 0);
        assert_eq!(folio_amount.amount_for_minting, 99_000_000);
    }

    #[test]
    fn test_to_assets_for_minting_insufficient_shares() {
        let mut user_amount = TokenAmount {
            mint: Pubkey::new_unique(),

            amount_for_minting: 100_000,
            amount_for_redeeming: 0,
        };

        let mut related_mint = TokenAmount {
            mint: user_amount.mint,

            amount_for_minting: 100_000,
            amount_for_redeeming: 0,
        };

        let decimal_total_supply = 100_000_000;
        let decimal_folio_balance = 50_000_000;
        let shares = 1_000_000; // Trying to mint more shares than possible

        let result = UserPendingBasket::to_assets_for_minting(
            &mut user_amount,
            &mut related_mint,
            decimal_total_supply,
            decimal_folio_balance,
            shares,
        );

        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err(),
            ErrorCode::InvalidShareAmountProvided.into()
        );
    }

    #[test]
    fn test_to_assets_for_redeeming() {
        let mut user_amount = TokenAmount {
            mint: Pubkey::new_unique(),

            amount_for_minting: 0,
            amount_for_redeeming: 0,
        };

        let mut related_mint = TokenAmount {
            mint: user_amount.mint,

            amount_for_minting: 0,
            amount_for_redeeming: 0,
        };

        // Total supply: 100 tokens
        // Folio balance: 50 tokens
        // Shares to redeem: 10 tokens
        let decimal_total_supply = 100_000_000;
        let decimal_folio_balance = 50_000_000;
        let shares = 10_000_000;

        let result = UserPendingBasket::to_assets_for_redeeming(
            &mut user_amount,
            &mut related_mint,
            decimal_total_supply,
            decimal_folio_balance,
            shares,
        );

        assert!(result.is_ok());

        // Should receive 5 tokens (10% of 50 tokens)
        assert_eq!(user_amount.amount_for_redeeming, 5_000_000);
        assert_eq!(related_mint.amount_for_redeeming, 5_000_000);
    }

    #[test]
    fn test_to_assets_for_redeeming_rounding() {
        let mut user_amount = TokenAmount {
            mint: Pubkey::new_unique(),

            amount_for_minting: 0,
            amount_for_redeeming: 0,
        };

        let mut related_mint = TokenAmount {
            mint: user_amount.mint,

            amount_for_minting: 0,
            amount_for_redeeming: 0,
        };

        let decimal_total_supply = 3_000_000;
        let decimal_folio_balance = 1_000_000;
        let shares = 1_000_000;

        let result = UserPendingBasket::to_assets_for_redeeming(
            &mut user_amount,
            &mut related_mint,
            decimal_total_supply,
            decimal_folio_balance,
            shares,
        );

        assert!(result.is_ok());

        assert_eq!(user_amount.amount_for_redeeming, 333_333);
        assert_eq!(related_mint.amount_for_redeeming, 333_333);
    }
}
