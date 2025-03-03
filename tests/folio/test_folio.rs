//! Tests for the Folio state

#[cfg(test)]
mod tests {
    use anchor_lang::prelude::*;
    use folio::state::Folio;
    use folio::utils::{AuctionEnd, Decimal, Rounding};
    use shared::constants::MAX_TVL_FEE;
    use shared::errors::ErrorCode;

    #[test]
    fn test_set_tvl_fee_zero() {
        let mut folio = Folio::default();
        let result = folio.set_tvl_fee(0);

        assert!(result.is_ok());
        assert_eq!(folio.tvl_fee, 0);
    }

    #[test]
    fn test_set_tvl_fee_max() {
        let mut folio = Folio::default();
        let result = folio.set_tvl_fee(MAX_TVL_FEE); // 10% annually
        assert!(result.is_ok());
        // (1 - (1 - 0.1)^(1/31536000)) * 1e18 ~= 3_340_960_000
        let expected_approx = 3_340_960_000u128;
        let tolerance = 100_000_000_000_000u128; // ~0.01% error accepted for max value

        assert!((folio.tvl_fee as i128 - expected_approx as i128).abs() < tolerance as i128);
    }

    #[test]
    fn test_set_tvl_fee_too_high() {
        let mut folio = Folio::default();
        let result = folio.set_tvl_fee(MAX_TVL_FEE + 1);

        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), ErrorCode::TVLFeeTooHigh.into());
    }

    #[test]
    fn test_set_tvl_fee_normal() {
        let mut folio = Folio::default();
        // Test with 5% annual fee (0.05 * D18)
        let annual_fee = 50_000_000_000_000_000u128;
        let result = folio.set_tvl_fee(annual_fee);

        assert!(result.is_ok());
        // (1 - (1 - 0.05)^(1/31536000)) * 1e18 ~= 1_626_499_693
        let expected_approx = 1_626_499_693;
        let tolerance = 1_000_000_000_000u128; // 0.05% in D18

        assert!((folio.tvl_fee as i128 - expected_approx as i128).abs() < tolerance as i128);
    }

    #[test]
    fn test_set_tvl_fee_very_small() {
        let mut folio = Folio::default();
        // Test with 0.1% annual fee (0.001 * D18)
        let annual_fee = 1_000_000_000_000_000u128;
        let result = folio.set_tvl_fee(annual_fee);

        assert!(result.is_ok());
        // (1 - (1 - 0.001)^(1/31536000)) * 1e18 ~= 31_725_700

        let expected_approx: i32 = 31_725_700;
        let tolerance = 1000;

        assert!((folio.tvl_fee as i128 - expected_approx as i128).abs() < tolerance as i128);
    }

    #[test]
    fn test_set_tvl_fee_multiple_updates() {
        let mut folio = Folio::default();

        // First update with 5%
        let result1 = folio.set_tvl_fee(50_000_000_000_000_000u128);
        assert!(result1.is_ok());
        let first_fee = folio.tvl_fee;

        // Second update with 2%
        let result2 = folio.set_tvl_fee(20_000_000_000_000_000u128);
        assert!(result2.is_ok());
        let second_fee = folio.tvl_fee;

        assert!(first_fee > second_fee);
    }

    #[test]
    fn test_set_tvl_fee_ten_percent() {
        let mut folio = Folio::default();

        // 10% annually in D18 format
        let annual_fee = 100_000_000_000_000_000u128;
        let result = folio.set_tvl_fee(annual_fee);

        assert!(result.is_ok());

        // Expected per-second fee calculation:
        // = 1 - (1 - 0.1)^(1/31536000)
        // ≈ 3.340959 × 10^-9
        // In D18 format: 3_340_959_957
        let expected_fee: u128 = 3_340_959_957u128;
        let tolerance = 2_000_000_000_000u128; // 0.2% in D18

        assert!(
            (folio.tvl_fee as i128 - expected_fee as i128).abs() < tolerance as i128,
            "Expected ~{} but got {}",
            expected_fee,
            folio.tvl_fee
        );
    }

    #[test]
    fn test_calculate_fees_for_minting_basic() {
        let mut folio = Folio {
            mint_fee: 50_000_000_000_000_000, // 5% mint fee (0.05 * D18)
            ..Folio::default()
        };

        let result = folio
            .calculate_fees_for_minting(
                1_000_000_000,             // 1 token in D9
                200_000_000_000_000_000,   // 20% dao fee (0.2 * D18)
                1_000_000_000_000_000_000, // denominator 1.0 * D18
                1_000_000_000_000_000,     // 0.1% floor (0.001 * D18)
            )
            .unwrap();

        // Expected total fee: 1 * 0.05 = 0.05 tokens
        // Expected dao fee: 0.05 * 0.2 = 0.01 tokens
        assert_eq!(result.0, 50_000_000); // 0.05 tokens in D9
        assert_eq!(folio.dao_pending_fee_shares, 10_000_000_000_000_000); // 0.01 * D18
        assert_eq!(
            folio.fee_recipients_pending_fee_shares,
            40_000_000_000_000_000
        ); // 0.04 * D18
    }

    #[test]
    fn test_calculate_fees_for_minting_floor_kicks_in() {
        let mut folio = Folio {
            mint_fee: 1_000_000_000_000_000, // 0.1% mint fee (0.001 * D18)
            ..Folio::default()
        };

        let result = folio
            .calculate_fees_for_minting(
                1_000_000_000,             // 1 token in D9
                200_000_000_000_000_000,   // 20% dao fee
                1_000_000_000_000_000_000, // denominator
                10_000_000_000_000_000,    // 1% floor (higher than calculated dao fee)
            )
            .unwrap();

        // Floor kicks in: 1% of 1 token = 0.01 tokens
        assert_eq!(result.0, 10_000_000); // 0.01 tokens in D9
        assert_eq!(folio.dao_pending_fee_shares, 10_000_000_000_000_000); // 0.01 * D18
        assert_eq!(folio.fee_recipients_pending_fee_shares, 0); // All fees go to DAO due to floor
    }

    #[test]
    fn test_calculate_fees_for_minting_large_amount() {
        let mut folio = Folio {
            mint_fee: 100_000_000_000_000_000, // 10% mint fee
            ..Folio::default()
        };

        let result = folio
            .calculate_fees_for_minting(
                1_000_000_000_000,         // 1000 tokens in D9
                200_000_000_000_000_000,   // 20% dao fee
                1_000_000_000_000_000_000, // denominator
                1_000_000_000_000_000,     // 0.1% floor
            )
            .unwrap();

        // Expected total fee: 1000 * 0.1 = 100 tokens
        // Expected dao fee: 100 * 0.2 = 20 tokens
        assert_eq!(result.0, 100_000_000_000); // 100 tokens in D9
        assert_eq!(folio.dao_pending_fee_shares, 20_000_000_000_000_000_000); // 20 * D18
        assert_eq!(
            folio.fee_recipients_pending_fee_shares,
            80_000_000_000_000_000_000
        ); // 80 * D18
    }

    #[test]
    fn test_calculate_fees_for_minting_zero_mint_fee() {
        let mut folio = Folio {
            mint_fee: 0,
            ..Folio::default()
        };

        let result = folio
            .calculate_fees_for_minting(
                1_000_000_000,             // 1 token
                200_000_000_000_000_000,   // 20% dao fee
                1_000_000_000_000_000_000, // denominator
                1_000_000_000_000_000,     // 0.1% floor
            )
            .unwrap();

        // With zero mint fee, only floor applies
        assert_eq!(result.0, 1_000_000); // 0.001 tokens in D9 (floor)
        assert_eq!(folio.dao_pending_fee_shares, 1_000_000_000_000_000); // 0.001 * D18
        assert_eq!(folio.fee_recipients_pending_fee_shares, 0);
    }

    #[test]
    fn test_calculate_fees_for_minting_small_amount() {
        let mut folio = Folio {
            mint_fee: 50_000_000_000_000_000, // 5% mint fee
            ..Folio::default()
        };

        let result = folio
            .calculate_fees_for_minting(
                1_000,                     // 0.000001 tokens in D9
                200_000_000_000_000_000,   // 20% dao fee
                1_000_000_000_000_000_000, // denominator
                1_000_000_000_000_000,     // 0.1% floor
            )
            .unwrap();

        // For 1_000 (0.000001 tokens):
        // Mint fee: 0.000001 * 0.05 = 0.00000005 tokens
        // This equals 50 in D9 format
        assert_eq!(result.0, 50);

        // DAO gets 20% of the fee
        // 0.00000005 * 0.2 = 0.00000001 tokens
        assert_eq!(folio.dao_pending_fee_shares, 10_000_000_000); // 0.00000001 * D18

        // Fee recipients get the rest (80%)
        // 0.00000005 * 0.8 = 0.00000004 tokens
        assert_eq!(folio.fee_recipients_pending_fee_shares, 40_000_000_000); // 0.00000004 * D18
    }

    #[test]
    fn test_calculate_fees_for_minting_accumulation() {
        let mut folio = Folio {
            mint_fee: 50_000_000_000_000_000, // 5% mint fee
            ..Folio::default()
        };

        // First mint
        folio
            .calculate_fees_for_minting(
                1_000_000_000,             // 1 token
                200_000_000_000_000_000,   // 20% dao fee
                1_000_000_000_000_000_000, // denominator
                1_000_000_000_000_000,     // 0.1% floor
            )
            .unwrap();

        let first_dao_pending = folio.dao_pending_fee_shares;
        let first_recipients_pending = folio.fee_recipients_pending_fee_shares;

        // Second mint
        folio
            .calculate_fees_for_minting(
                1_000_000_000,             // Another 1 token
                200_000_000_000_000_000,   // 20% dao fee
                1_000_000_000_000_000_000, // denominator
                1_000_000_000_000_000,     // 0.1% floor
            )
            .unwrap();

        // Fees should accumulate
        assert_eq!(folio.dao_pending_fee_shares, first_dao_pending * 2);
        assert_eq!(
            folio.fee_recipients_pending_fee_shares,
            first_recipients_pending * 2
        );
    }

    #[test]
    fn test_get_total_supply() {
        let folio = Folio {
            dao_pending_fee_shares: 1_000_000_000_000_000_000, // 1.0 * D18
            fee_recipients_pending_fee_shares: 2_000_000_000_000_000_000, // 2.0 * D18
            ..Folio::default()
        };

        // Test with 10 tokens in circulation
        let result = folio.get_total_supply(10_000_000_000).unwrap(); // 10.0 * D9

        // Expected: 10 + 1 + 2 = 13 tokens
        assert_eq!(
            result.to_scaled(Rounding::Floor).unwrap(),
            13_000_000_000_000_000_000
        );
    }

    #[test]
    fn test_get_total_supply_zero_fees() {
        let folio = Folio::default();

        // Test with 5 tokens in circulation and no pending fees
        let result = folio.get_total_supply(5_000_000_000).unwrap(); // 5.0 * D9

        // Expected: just the token supply
        assert_eq!(
            result.to_scaled(Rounding::Floor).unwrap(),
            5_000_000_000_000_000_000
        );
    }

    #[test]
    fn test_poke_zero_elapsed() {
        let mut folio = Folio {
            last_poke: 1000,
            tvl_fee: 3_340_959_957, // 10% annual
            ..Folio::default()
        };

        let result = folio.poke(
            1_000_000_000,             // 1.0 token supply
            1000,                      // same as last_poke
            200_000_000_000_000_000,   // 20% dao fee
            1_000_000_000_000_000_000, // denominator
            1_000_000_000_000_000,     // 0.1% floor
        );

        assert!(result.is_ok());
        assert_eq!(folio.dao_pending_fee_shares, 0);
        assert_eq!(folio.fee_recipients_pending_fee_shares, 0);
    }

    #[test]
    fn test_poke_with_existing_pending_fees() {
        let mut folio = Folio {
            last_poke: 0,
            tvl_fee: 3_340_959_957,                            // 10% annual
            dao_pending_fee_shares: 1_000_000_000_000_000_000, // 1.0 existing DAO fees
            fee_recipients_pending_fee_shares: 2_000_000_000_000_000_000, // 2.0 existing recipient fees
            ..Folio::default()
        };

        let result = folio.poke(
            1_000_000_000,             // 1.0 token supply
            1,                         // 1 second elapsed
            200_000_000_000_000_000,   // 20% dao fee
            1_000_000_000_000_000_000, // denominator
            1_000_000_000_000_000,     // 0.1% floor
        );

        assert!(result.is_ok());
        assert!(folio.dao_pending_fee_shares > 1_000_000_000_000_000_000);
        assert!(folio.fee_recipients_pending_fee_shares > 2_000_000_000_000_000_000);
    }

    #[test]
    fn test_poke_multiple_times() {
        let mut folio = Folio {
            tvl_fee: 3_340_959_957, // 10% annual
            ..Folio::default()
        };

        // First poke
        folio
            .poke(
                1_000_000_000,             // 1.0 token supply
                1,                         // 1 second elapsed
                200_000_000_000_000_000,   // 20% dao fee
                1_000_000_000_000_000_000, // denominator
                1_000_000_000_000_000,     // 0.1% floor
            )
            .unwrap();

        let first_dao = folio.dao_pending_fee_shares;
        let first_recipients = folio.fee_recipients_pending_fee_shares;

        // Second poke
        folio
            .poke(
                1_000_000_000,             // 1.0 token supply
                2,                         // 2 seconds elapsed
                200_000_000_000_000_000,   // 20% dao fee
                1_000_000_000_000_000_000, // denominator
                1_000_000_000_000_000,     // 0.1% floor
            )
            .unwrap();

        assert!(folio.dao_pending_fee_shares > first_dao);
        assert!(folio.fee_recipients_pending_fee_shares > first_recipients);
    }

    #[test]
    fn test_poke_long_time_elapsed() {
        let mut folio = Folio {
            last_poke: 0,
            tvl_fee: 3_340_959_957, // 10% annual
            ..Folio::default()
        };

        let one_day = 86400;
        let result = folio.poke(
            1_000_000_000,             // 1.0 token supply
            one_day,                   // one day elapsed
            200_000_000_000_000_000,   // 20% dao fee
            1_000_000_000_000_000_000, // denominator
            1_000_000_000_000_000,     // 0.1% floor
        );

        assert!(result.is_ok());
        assert!(folio.dao_pending_fee_shares > 0);
        assert!(folio.fee_recipients_pending_fee_shares > 0);
        assert_eq!(folio.last_poke, one_day);
    }

    #[test]
    fn test_get_pending_fee_shares_basic() {
        let folio = Folio {
            tvl_fee: 3_340_959_957, // 10% annual
            ..Folio::default()
        };

        let (fee_recipients, dao_shares) = folio
            .get_pending_fee_shares(
                1_000_000_000,             // 1.0 token supply
                1,                         // 1 second elapsed
                200_000_000_000_000_000,   // 20% dao fee
                1_000_000_000_000_000_000, // denominator
                1_000_000_000_000_000,     // 0.1% floor
            )
            .unwrap();

        assert!(dao_shares > Decimal::ZERO);
        assert!(fee_recipients > Decimal::ZERO);
        assert!(fee_recipients > dao_shares); // Fee recipients should get 80%
    }

    #[test]
    fn test_get_pending_fee_shares_fee_floor_kicks_in() {
        let folio = Folio {
            tvl_fee: 33_409_599, // Very low TVL fee
            ..Folio::default()
        };

        let (fee_recipients, dao_shares) = folio
            .get_pending_fee_shares(
                1_000_000_000,             // 1.0 tokens supply
                1,                         // 1 second elapsed
                200_000_000_000_000_000,   // 20% dao fee
                1_000_000_000_000_000_000, // denominator
                100_000_000_000_000_000,   // 10% floor (much higher than TVL fee)
            )
            .unwrap();

        // Allow for 0.2% difference
        let expected = 3_340_959_968u128;
        let actual = dao_shares.to_scaled(Rounding::Floor).unwrap();
        let diff = if actual > expected {
            actual - expected
        } else {
            expected - actual
        };

        assert!(
            diff < 10_000_000, // About 0.2% tolerance
            "Result differs too much. Got: {}, Expected: {}",
            actual,
            expected
        );
        assert_eq!(fee_recipients.to_scaled(Rounding::Floor).unwrap(), 0);
    }

    #[test]
    fn test_get_pending_fee_shares_zero_supply() {
        let folio = Folio {
            tvl_fee: 3_340_959_957u128, // 10% annual
            ..Folio::default()
        };

        let (fee_recipients, dao_shares) = folio
            .get_pending_fee_shares(
                0,                         // zero supply
                1,                         // 1 second elapsed
                200_000_000_000_000_000,   // 20% dao fee
                1_000_000_000_000_000_000, // denominator
                1_000_000_000_000_000,     // 0.1% floor
            )
            .unwrap();

        assert_eq!(fee_recipients.to_scaled(Rounding::Floor).unwrap(), 0);
        assert_eq!(dao_shares.to_scaled(Rounding::Floor).unwrap(), 0);
    }

    #[test]
    fn test_get_pending_fee_shares_with_existing_fees() {
        let mut folio = Folio {
            tvl_fee: 3_340_959_957, // 10% annual
            ..Folio::default()
        };

        // Set initial pending fees
        let initial_dao_fees = 1_000_000_000_000_000_000u128; // 1.0
        let initial_recipient_fees = 2_000_000_000_000_000_000u128; // 2.0

        folio.dao_pending_fee_shares = initial_dao_fees;
        folio.fee_recipients_pending_fee_shares = initial_recipient_fees;

        let (fee_recipients, dao_shares) = folio
            .get_pending_fee_shares(
                10_000_000_000,            // 10.0 tokens supply
                3600,                      // 1 hour elapsed
                200_000_000_000_000_000,   // 20% dao fee
                1_000_000_000_000_000_000, // denominator
                1_000_000_000_000_000,     // 0.1% floor
            )
            .unwrap();

        // The new shares should be non-zero
        assert!(dao_shares > Decimal::ZERO);
        assert!(fee_recipients > Decimal::ZERO);

        // For 10 tokens over 1 hour at 10% annual rate
        // we expect roughly 0.001% in fees
        let min_expected_increase = Decimal::from_scaled(10_000_000_000_000u128); // 0.00001
        assert!(dao_shares > min_expected_increase);
        assert!(fee_recipients > min_expected_increase);
    }

    #[test]
    fn test_get_auction_end_for_mints() {
        let mut folio = Folio::default();
        let sell_mint = Pubkey::new_unique();
        let buy_mint = Pubkey::new_unique();

        let sell_auction = AuctionEnd {
            mint: sell_mint,
            end_time: 100,
        };
        let buy_auction = AuctionEnd {
            mint: buy_mint,
            end_time: 200,
        };

        folio.sell_ends = [AuctionEnd::default(); 16];
        folio.buy_ends = [AuctionEnd::default(); 16];

        folio.sell_ends[0] = sell_auction;
        folio.buy_ends[0] = buy_auction;

        let (found_sell, found_buy) = folio
            .get_auction_end_for_mints(&sell_mint, &buy_mint)
            .unwrap();

        assert!(found_sell.is_some());
        assert!(found_buy.is_some());
        assert_eq!(found_sell.unwrap().end_time, 100);
        assert_eq!(found_buy.unwrap().end_time, 200);
    }

    #[test]
    fn test_get_auction_end_for_mints_not_found() {
        let mut folio = Folio::default();
        let sell_mint = Pubkey::new_unique();
        let buy_mint = Pubkey::new_unique();
        let different_mint = Pubkey::new_unique();

        let sell_auction = AuctionEnd {
            mint: sell_mint,
            end_time: 100,
        };
        let buy_auction = AuctionEnd {
            mint: buy_mint,
            end_time: 200,
        };

        folio.sell_ends = [AuctionEnd::default(); 16];
        folio.buy_ends = [AuctionEnd::default(); 16];

        folio.sell_ends[0] = sell_auction;
        folio.buy_ends[0] = buy_auction;

        let (found_sell, found_buy) = folio
            .get_auction_end_for_mints(&different_mint, &different_mint)
            .unwrap();

        assert!(found_sell.is_none());
        assert!(found_buy.is_none());
    }

    #[test]
    fn test_get_auction_end_for_mints_multiple_auctions() {
        let mut folio = Folio::default();
        let sell_mint1 = Pubkey::new_unique();
        let sell_mint2 = Pubkey::new_unique();
        let buy_mint1 = Pubkey::new_unique();
        let buy_mint2 = Pubkey::new_unique();

        folio.sell_ends = [AuctionEnd::default(); 16];
        folio.buy_ends = [AuctionEnd::default(); 16];

        folio.sell_ends[0] = AuctionEnd {
            mint: sell_mint1,
            end_time: 100,
        };
        folio.sell_ends[1] = AuctionEnd {
            mint: sell_mint2,
            end_time: 150,
        };

        folio.buy_ends[0] = AuctionEnd {
            mint: buy_mint1,
            end_time: 200,
        };
        folio.buy_ends[1] = AuctionEnd {
            mint: buy_mint2,
            end_time: 250,
        };

        let (found_sell, found_buy) = folio
            .get_auction_end_for_mints(&sell_mint2, &buy_mint2)
            .unwrap();

        assert!(found_sell.is_some());
        assert!(found_buy.is_some());
        assert_eq!(found_sell.unwrap().end_time, 150);
        assert_eq!(found_buy.unwrap().end_time, 250);
    }

    #[test]
    fn test_get_auction_end_for_mints_empty_lists() {
        let folio = Folio::default();
        let sell_mint = Pubkey::new_unique();
        let buy_mint = Pubkey::new_unique();

        let (found_sell, found_buy) = folio
            .get_auction_end_for_mints(&sell_mint, &buy_mint)
            .unwrap();

        assert!(found_sell.is_none());
        assert!(found_buy.is_none());
    }

    #[test]
    fn test_set_auction_end_for_mints() {
        let mut folio = Folio::default();
        let sell_mint = Pubkey::new_unique();
        let buy_mint = Pubkey::new_unique();

        // Setup initial auction ends
        folio.sell_ends = [AuctionEnd::default(); 16];
        folio.buy_ends = [AuctionEnd::default(); 16];

        folio.sell_ends[0] = AuctionEnd {
            mint: sell_mint,
            end_time: 100,
        };

        folio.buy_ends[0] = AuctionEnd {
            mint: buy_mint,
            end_time: 200,
        };
        // Update the end times
        folio.set_auction_end_for_mints(&sell_mint, &buy_mint, 150, 250);

        // Verify updates
        assert_eq!(folio.sell_ends[0].end_time, 150);
        assert_eq!(folio.buy_ends[0].end_time, 250);
    }

    #[test]
    fn test_set_auction_end_for_mints_no_matching_mint() {
        let mut folio = Folio::default();
        let sell_mint = Pubkey::new_unique();
        let buy_mint = Pubkey::new_unique();
        let different_mint = Pubkey::new_unique();

        // Setup initial auction ends
        folio.sell_ends = [AuctionEnd::default(); 16];
        folio.buy_ends = [AuctionEnd::default(); 16];

        folio.sell_ends[0].end_time = 100;
        folio.sell_ends[0].mint = sell_mint;
        folio.buy_ends[0].end_time = 200;
        folio.buy_ends[0].mint = buy_mint;
        // Try to update with non-matching mint
        folio.set_auction_end_for_mints(&different_mint, &different_mint, 150, 250);

        // Verify no changes
        assert_eq!(folio.sell_ends[0].end_time, 100);
        assert_eq!(folio.buy_ends[0].end_time, 200);
    }
}
