//! Tests for the Auction state

#[cfg(test)]
mod tests {

    use std::cell::RefCell;

    use anchor_lang::prelude::Pubkey;
    use folio::state::{Auction, Folio};
    use folio::utils::structs::AuctionStatus;
    use folio::utils::{AuctionEnd, BasketRange, Prices};
    use shared::constants::{MAX_RATE, MAX_TTL};
    use shared::errors::ErrorCode;
    use shared::errors::ErrorCode::*;

    fn setup_auction() -> Auction {
        let mut auction = Auction::default();
        auction.prices.start = 1_000_000;
        auction.prices.end = 900_000;
        auction.launch_timeout = 2000;
        auction
    }

    #[test]
    fn test_validate_auction_approve() {
        // Valid case
        let sell_limit = BasketRange {
            spot: 50,
            low: 25,
            high: 75,
        };
        let buy_limit = BasketRange {
            spot: 100,
            low: 50,
            high: 150,
        };
        let prices = Prices {
            start: 1000,
            end: 500,
        };
        let ttl = 3600;

        assert!(Auction::validate_auction_approve(&sell_limit, &buy_limit, &prices, ttl).is_ok());

        // Invalid sell limit (high > MAX_RATE)
        let invalid_sell_limit = BasketRange {
            spot: 50,
            low: 25,
            high: MAX_RATE + 1,
        };
        assert_eq!(
            Auction::validate_auction_approve(&invalid_sell_limit, &buy_limit, &prices, ttl).err(),
            Some(InvalidSellLimit.into())
        );

        // Invalid buy limit (spot = 0)
        let invalid_buy_limit = BasketRange {
            spot: 0,
            low: 50,
            high: 150,
        };
        assert_eq!(
            Auction::validate_auction_approve(&sell_limit, &invalid_buy_limit, &prices, ttl).err(),
            Some(InvalidBuyLimit.into())
        );

        // Invalid prices (start < end)
        let invalid_prices = Prices {
            start: 500,
            end: 1000,
        };
        assert_eq!(
            Auction::validate_auction_approve(&sell_limit, &buy_limit, &invalid_prices, ttl).err(),
            Some(InvalidPrices.into())
        );

        // Invalid TTL
        let invalid_ttl = MAX_TTL + 1;
        assert_eq!(
            Auction::validate_auction_approve(&sell_limit, &buy_limit, &prices, invalid_ttl).err(),
            Some(InvalidTtl.into())
        );
    }

    #[test]
    fn test_validate_auction_opening_from_auction_launcher() {
        let mut auction = setup_auction();
        auction.sell_limit = BasketRange {
            spot: 50,
            low: 25,
            high: 75,
        };
        auction.buy_limit = BasketRange {
            spot: 100,
            low: 50,
            high: 150,
        };
        auction.prices = Prices {
            start: 1000,
            end: 500,
        };

        // Valid case
        assert!(auction
            .validate_auction_opening_from_auction_launcher(1500, 600, 50, 100)
            .is_ok());

        // Invalid start price (< auction.prices.start)
        assert_eq!(
            auction
                .validate_auction_opening_from_auction_launcher(900, 600, 50, 100)
                .err(),
            Some(InvalidPrices.into())
        );

        // Invalid start price (> 100 * auction.prices.start)
        assert_eq!(
            auction
                .validate_auction_opening_from_auction_launcher(100001, 600, 50, 100)
                .err(),
            Some(InvalidPrices.into())
        );

        // Invalid sell limit (< low)
        assert_eq!(
            auction
                .validate_auction_opening_from_auction_launcher(1500, 600, 20, 100)
                .err(),
            Some(InvalidSellLimit.into())
        );

        // Invalid buy limit (> high)
        assert_eq!(
            auction
                .validate_auction_opening_from_auction_launcher(1500, 600, 50, 200)
                .err(),
            Some(InvalidBuyLimit.into())
        );
    }

    #[test]
    fn test_try_get_status() {
        let mut auction = setup_auction();

        auction.start = 0;
        auction.end = 0;
        assert_eq!(
            auction.try_get_status(1000).unwrap(),
            AuctionStatus::APPROVED
        );

        auction.start = 1000;
        auction.end = 3000;
        assert_eq!(auction.try_get_status(2000).unwrap(), AuctionStatus::Open);

        auction.start = 1000;
        auction.end = 1500;
        assert_eq!(auction.try_get_status(2000).unwrap(), AuctionStatus::Closed);
    }

    #[test]
    fn test_open_auction() {
        let now = 1000u64;
        let auction_length = 3600u64;

        let sell_mint = Pubkey::new_unique();
        let buy_mint = Pubkey::new_unique();

        let folio = Folio {
            auction_length,
            ..Folio::default()
        };

        let mut auction = Auction {
            id: 1,
            prices: Prices {
                start: 10_000000000000000000u128, // 10 * D18
                end: 1_000000000000000000u128,    // 1 * D18
            },
            launch_timeout: now + 1000,
            sell: sell_mint,
            buy: buy_mint,
            ..Auction::default()
        };

        let folio_ref = RefCell::new(folio);
        let mut ref_folio = folio_ref.borrow_mut();

        auction.open_auction(&mut ref_folio, now).unwrap();

        assert_eq!(auction.start, now);
        assert_eq!(auction.end, now + auction_length);
        assert_eq!(auction.k, 639606970276123u128); // ln(10)/3600 * D18
    }

    #[test]
    fn test_open_auction_flat_price() {
        let now = 1000u64;
        let auction_length = 3600u64;

        let folio = Folio {
            auction_length,
            ..Folio::default()
        };

        let sell_mint = Pubkey::new_unique();
        let buy_mint = Pubkey::new_unique();

        let mut auction = Auction {
            id: 1,
            prices: Prices {
                start: 1_000000000000000000u128, // 1 * D18
                end: 1_000000000000000000u128,   // 1 * D18
            },
            launch_timeout: now + 1000,
            sell: sell_mint,
            buy: buy_mint,
            ..Auction::default()
        };

        let folio_ref = RefCell::new(folio);
        let mut ref_folio = folio_ref.borrow_mut();

        auction.open_auction(&mut ref_folio, now).unwrap();

        assert_eq!(auction.start, now);
        assert_eq!(auction.end, now + auction_length);
        assert_eq!(auction.k, 0);
    }

    #[test]
    fn test_open_auction_timeout() {
        let now = 2000u64;
        let auction_length = 3600u64;

        let folio = Folio {
            auction_length,
            ..Folio::default()
        };

        let sell_mint = Pubkey::new_unique();
        let buy_mint = Pubkey::new_unique();

        let mut auction = Auction {
            id: 1,
            prices: Prices {
                start: 10_000000000000000000u128,
                end: 1_000000000000000000u128,
            },
            launch_timeout: 1000, // timeout in past
            sell: sell_mint,
            buy: buy_mint,
            ..Auction::default()
        };

        let folio_ref = RefCell::new(folio);
        let mut ref_folio = folio_ref.borrow_mut();

        let result = auction.open_auction(&mut ref_folio, now);

        assert!(matches!(result, Err(error) if error == ErrorCode::AuctionTimeout.into()));
    }

    #[test]
    fn test_open_auction_collision() {
        let now = 1000u64;
        let auction_length = 3600u64;

        let sell_mint = Pubkey::new_unique();
        let buy_mint = Pubkey::new_unique();

        let mut sell_ends = [AuctionEnd {
            mint: Pubkey::default(),
            end_time: 0,
        }; 16];

        let mut buy_ends = [AuctionEnd {
            mint: Pubkey::default(),
            end_time: 0,
        }; 16];

        // Got to have buy mint for sell ends for collision
        sell_ends[0].mint = buy_mint;
        sell_ends[0].end_time = now + 100;
        buy_ends[0].mint = buy_mint;
        buy_ends[0].end_time = now + 100;

        let folio = Folio {
            auction_length,
            sell_ends,
            buy_ends,
            ..Folio::default()
        };

        let mut auction = Auction {
            id: 1,
            prices: Prices {
                start: 10_000000000000000000u128,
                end: 1_000000000000000000u128,
            },
            launch_timeout: now + 1000,
            sell: sell_mint, // Try to sell token that's in existing auction
            buy: buy_mint,
            ..Auction::default()
        };

        let folio_ref = RefCell::new(folio);
        let mut ref_folio = folio_ref.borrow_mut();

        let result = auction.open_auction(&mut ref_folio, now);

        assert!(matches!(result, Err(error) if error == ErrorCode::AuctionCollision.into()));
    }

    #[test]
    fn test_open_auction_invalid_prices() {
        let now = 1000u64;
        let auction_length = 3600u64;

        let folio = Folio {
            auction_length,
            ..Folio::default()
        };

        let sell_mint = Pubkey::new_unique();
        let buy_mint = Pubkey::new_unique();

        let mut auction = Auction {
            id: 1,
            prices: Prices {
                start: 1_000000000000000000u128, // 1 * D18
                end: 10_000000000000000000u128,  // 10 * D18 (end > start)
            },
            launch_timeout: now + 1000,
            sell: sell_mint,
            buy: buy_mint,
            ..Auction::default()
        };

        let folio_ref = RefCell::new(folio);
        let mut ref_folio = folio_ref.borrow_mut();

        let result = auction.open_auction(&mut ref_folio, now);

        assert!(matches!(result, Err(error) if error == ErrorCode::InvalidPrices.into()));
    }

    #[test]
    fn test_open_auction_updates_auction_ends() {
        let now = 1000u64;
        let auction_length = 3600u64;

        let sell_mint = Pubkey::new_unique();
        let buy_mint = Pubkey::new_unique();

        let mut sell_ends = [AuctionEnd {
            mint: Pubkey::default(),
            end_time: 0,
        }; 16];

        let mut buy_ends = [AuctionEnd {
            mint: Pubkey::default(),
            end_time: 0,
        }; 16];

        sell_ends[0].mint = sell_mint;
        sell_ends[0].end_time = now - 100;
        buy_ends[0].mint = buy_mint;
        buy_ends[0].end_time = now - 100;

        let folio = Folio {
            auction_length,
            sell_ends,
            buy_ends,
            ..Folio::default()
        };

        let mut auction = Auction {
            id: 1,
            prices: Prices {
                start: 10_000000000000000000u128,
                end: 1_000000000000000000u128,
            },
            launch_timeout: now + 1000,
            sell: sell_mint,
            buy: buy_mint,
            ..Auction::default()
        };

        let folio_ref = RefCell::new(folio);
        let mut ref_folio = folio_ref.borrow_mut();

        auction.open_auction(&mut ref_folio, now).unwrap();

        assert_eq!(ref_folio.sell_ends[0].end_time, now + auction_length);
        assert_eq!(ref_folio.buy_ends[0].end_time, now + auction_length);
    }

    #[test]
    fn test_calculate_k() {
        // Test case 1: 2x price drop over 3600 seconds
        let mut auction = Auction {
            prices: Prices {
                start: 2000000000000000000u128, // 2 * D18
                end: 1000000000000000000u128,   // 1 * D18
            },
            k: 0,
            ..Auction::default()
        };

        auction.calculate_k(3600).unwrap();
        // ln(2)/3600 ≈ 192,540,883,488,873.6970603423 (in D18)
        let expected_k = 192_540_883_488_873u128;

        assert!(auction.k >= expected_k - 1000u128 && auction.k <= expected_k + 1000u128);

        // Test case 2: 10x price drop over 1 hour (3600 seconds)
        let mut auction = Auction {
            prices: Prices {
                start: 10000000000000000000u128, // 10 * D18
                end: 1000000000000000000u128,    // 1 * D18
            },
            k: 0,
            ..Auction::default()
        };

        auction.calculate_k(3600).unwrap();
        // ln(10)/3600 ≈ 639,606,970,276,123.8011161087 (in D18)
        let expected_k = 639_606_970_276_123u128;

        assert!(auction.k >= expected_k - 1000u128 && auction.k <= expected_k + 1000u128);

        // Test case 3: Same price (ratio = 1)
        let mut auction = Auction {
            prices: Prices {
                start: 1000000000000000000u128, // 1 * D18
                end: 1000000000000000000u128,   // 1 * D18
            },
            k: 0,
            ..Auction::default()
        };

        auction.calculate_k(3600).unwrap();
        assert_eq!(auction.k, 0); // ln(1) = 0, so k should be 0

        // Test case 4: Very large price drop over longer period
        let mut auction = Auction {
            prices: Prices {
                start: 1000000000000000000000u128, // 1000 * D18
                end: 1000000000000000000u128,      // 1 * D18
            },
            k: 0,
            ..Auction::default()
        };

        auction.calculate_k(86400).unwrap(); // 24 hours
                                             // ln(1000)*1e18/86400 ≈ 0.000080009897 * D18
        let expected_k = 79_950_871_284_515u128;
        assert!(auction.k >= expected_k - 1000u128 && auction.k <= expected_k + 1000u128);
    }

    #[test]
    fn test_get_price() {
        let now = 1000u64;
        let auction_length = 3600u64; // 1 hour
        let end_time = now + auction_length;

        let auction = Auction {
            start: now,
            end: end_time,
            prices: Prices {
                start: 10000000000000000000u128, // 10 * D18
                end: 1000000000000000000u128,    // 1 * D18
            },
            k: 639606970276123u128, // ln(10)/3600 * D18
            ..Auction::default()
        };

        // Test start time
        let price = auction.get_price(now).unwrap();
        assert_eq!(price, auction.prices.start);

        // Test end time
        let price = auction.get_price(end_time).unwrap();
        assert_eq!(price, auction.prices.end);

        // Test halfway point (1800 seconds)
        let mid_time = now + (auction_length / 2);
        let price = auction.get_price(mid_time).unwrap();
        // At halfway, price should be around sqrt(10) * D18 ≈ 3.162277660168379 * D18
        let expected = 3162277660168379332u128;
        assert!(price >= expected - 1000000000 && price <= expected + 1000000000);

        // Test quarter way (900 seconds)
        let quarter_time = now + (auction_length / 4);
        let price = auction.get_price(quarter_time).unwrap();
        // At quarter way, price should be around 10^0.75 * D18 ≈ 5.623413251903491 * D18
        let expected = 5623413251903491345u128;
        assert!(price >= expected - 1000000000 && price <= expected + 1000000000);

        // Test before start time
        let result = auction.get_price(now - 1);
        assert!(result.is_err());

        // Test after end time
        let result = auction.get_price(end_time + 1);
        assert!(result.is_err());

        // Test price never goes below end price
        let almost_end = end_time - 1;
        let price = auction.get_price(almost_end).unwrap();
        assert!(price >= auction.prices.end);
    }

    #[test]
    fn test_get_price_flat_auction() {
        let now = 1000u64;
        let auction_length = 3600u64;
        let end_time = now + auction_length;

        let auction = Auction {
            start: now,
            end: end_time,
            prices: Prices {
                start: 1000000000000000000u128, // 1 * D18
                end: 1000000000000000000u128,   // 1 * D18
            },
            k: 0,
            ..Auction::default()
        };

        // Test middle time
        let mid_time = now + (auction_length / 2);
        let price = auction.get_price(mid_time).unwrap();
        assert_eq!(price, auction.prices.start);
    }

    #[test]
    fn test_get_price_small_difference() {
        let now = 1000u64;
        let auction_length = 3600u64;
        let end_time = now + auction_length;

        let mut auction = Auction {
            start: now,
            end: end_time,
            prices: Prices {
                start: 1100000000000000000u128, // 1.1 * D18
                end: 1000000000000000000u128,   // 1.0 * D18
            },
            ..Auction::default()
        };

        auction.calculate_k(auction_length).unwrap();

        // Test middle time
        let mid_time = now + (auction_length / 2);
        let price = auction.get_price(mid_time).unwrap();
        // At halfway, price should be around 1.0488088481701515 * D18
        let expected = 1048808848170151500u128;
        assert!(price >= expected - 1000000000 && price <= expected + 1000000000);
    }
}
