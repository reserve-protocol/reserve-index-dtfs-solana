#[cfg(test)]
mod tests {

    use folio::state::{Auction, Folio};
    use folio::utils::structs::AuctionStatus;
    use shared::constants::D18;
    use spl_math::uint::U256;

    fn setup_auction() -> Auction {
        let mut auction = Auction::default();
        auction.prices.start = 1_000_000;
        auction.prices.end = 900_000;
        auction.launch_timeout = 2000;
        auction
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
    fn test_validate_auction_opening_from_auction_launcher() {
        let auction = setup_auction();

        assert!(auction
            .validate_auction_opening_from_auction_launcher(
                auction.prices.start,
                auction.prices.end,
                auction.sell_limit.low,
                auction.buy_limit.low
            )
            .is_ok());

        assert!(auction
            .validate_auction_opening_from_auction_launcher(
                auction.prices.start * 99,
                auction.prices.end,
                auction.sell_limit.low,
                auction.buy_limit.low
            )
            .is_ok());

        assert!(auction
            .validate_auction_opening_from_auction_launcher(
                auction.prices.start * 101,
                auction.prices.end,
                auction.sell_limit.low,
                auction.buy_limit.low
            )
            .is_err());
    }

    #[test]
    fn test_open_auction() {
        let mut auction = setup_auction();
        let mut folio = Folio::default();

        folio.auction_length = 1000;
        auction.launch_timeout = 2000;

        let current_time = 1500;

        assert!(auction.open_auction(&folio, current_time).is_ok());
        assert_eq!(auction.start, current_time);
        assert_eq!(auction.end, current_time + folio.auction_length);
    }

    #[test]
    fn test_calculate_k() {
        let mut auction = setup_auction();
        let auction_length = 1000;

        auction.prices.start = 1_000_000 * D18.as_u128();
        auction.prices.end = 900_000 * D18.as_u128();
        assert!(auction.calculate_k(auction_length).is_ok());
        assert!(auction.k.to_u256() > U256::from(0));

        auction.prices.start = auction.prices.end;
        assert!(auction.calculate_k(auction_length).is_ok());
        assert_eq!(auction.k.to_u256(), U256::from(0));
    }

    #[test]
    fn test_calculate_k_different_ratios() {
        let mut auction = setup_auction();
        let auction_length = 1000;

        auction.prices.start = 1_000_000 * D18.as_u128();
        auction.prices.end = 900_000 * D18.as_u128();
        assert!(auction.calculate_k(auction_length).is_ok());
        let k_10_percent = auction.k;

        auction.prices.start = 1_000_000 * D18.as_u128();
        auction.prices.end = 800_000 * D18.as_u128();
        assert!(auction.calculate_k(auction_length).is_ok());
        let k_20_percent = auction.k;

        assert!(k_20_percent.to_u256() > k_10_percent.to_u256());
    }

    #[test]
    fn test_get_price_is_not_ongoing() {
        let mut auction = setup_auction();
        auction.start = 1000;

        assert!(auction.get_price(500).is_err());
    }

    #[test]
    fn test_get_price() {
        let mut auction = setup_auction();
        auction.start = 1000;
        auction.end = 2000;

        auction.prices.start = 1_000_000 * D18.as_u128();
        auction.prices.end = 900_000 * D18.as_u128();
        auction.calculate_k(1000).unwrap();

        assert_eq!(auction.get_price(1000).unwrap(), 1_000_000 * D18.as_u128());
        assert_eq!(auction.get_price(2000).unwrap(), 900_000 * D18.as_u128());

        let mid_price = auction.get_price(1500).unwrap();
        assert!(mid_price < 1_000_000 * D18.as_u128());
        assert!(mid_price > 900_000 * D18.as_u128());

        assert!(auction.get_price(500).is_err());
        assert!(auction.get_price(2500).is_err());
    }

    #[test]
    fn test_get_price_flat_rate() {
        let mut auction = setup_auction();
        auction.start = 1000;
        auction.end = 2000;
        auction.prices.start = 1_000_000;
        auction.prices.end = 1_000_000;
        auction.calculate_k(1000).unwrap();

        assert_eq!(auction.get_price(1000).unwrap(), 1_000_000);
        assert_eq!(auction.get_price(1500).unwrap(), 1_000_000);
        assert_eq!(auction.get_price(2000).unwrap(), 1_000_000);
    }
}
