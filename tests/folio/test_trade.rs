#[cfg(test)]
mod tests {

    use folio::state::{Folio, Trade};
    use folio::utils::structs::TradeStatus;
    use shared::constants::D18;
    use spl_math::uint::U256;

    fn setup_trade() -> Trade {
        let mut trade = Trade::default();
        trade.start_price = 1_000_000;
        trade.end_price = 900_000;
        trade.launch_timeout = 2000;
        trade
    }

    #[test]
    fn test_try_get_status() {
        let mut trade = setup_trade();

        trade.start = 0;
        trade.end = 0;
        assert_eq!(trade.try_get_status(1000).unwrap(), TradeStatus::APPROVED);

        trade.start = 1000;
        trade.end = 3000;
        assert_eq!(trade.try_get_status(2000).unwrap(), TradeStatus::Open);

        trade.start = 1000;
        trade.end = 1500;
        assert_eq!(trade.try_get_status(2000).unwrap(), TradeStatus::Closed);
    }

    #[test]
    fn test_validate_trade_opening_from_trade_launcher() {
        let trade = setup_trade();

        assert!(trade
            .validate_trade_opening_from_trade_launcher(
                trade.start_price,
                trade.end_price,
                trade.sell_limit.low,
                trade.buy_limit.low
            )
            .is_ok());

        assert!(trade
            .validate_trade_opening_from_trade_launcher(
                trade.start_price * 99,
                trade.end_price,
                trade.sell_limit.low,
                trade.buy_limit.low
            )
            .is_ok());

        assert!(trade
            .validate_trade_opening_from_trade_launcher(
                trade.start_price * 101,
                trade.end_price,
                trade.sell_limit.low,
                trade.buy_limit.low
            )
            .is_err());
    }

    #[test]
    fn test_open_trade() {
        let mut trade = setup_trade();
        let mut folio = Folio::default();

        folio.auction_length = 1000;
        trade.launch_timeout = 2000;

        let current_time = 1500;

        assert!(trade.open_trade(&folio, current_time).is_ok());
        assert_eq!(trade.start, current_time);
        assert_eq!(trade.end, current_time + folio.auction_length);
    }

    #[test]
    fn test_calculate_k() {
        let mut trade = setup_trade();
        let auction_length = 1000;

        trade.start_price = 1_000_000 * D18.as_u128();
        trade.end_price = 900_000 * D18.as_u128();
        assert!(trade.calculate_k(auction_length).is_ok());
        assert!(trade.k.to_u256() > U256::from(0));

        trade.start_price = trade.end_price;
        assert!(trade.calculate_k(auction_length).is_ok());
        assert_eq!(trade.k.to_u256(), U256::from(0));
    }

    #[test]
    fn test_calculate_k_different_ratios() {
        let mut trade = setup_trade();
        let auction_length = 1000;

        trade.start_price = 1_000_000 * D18.as_u128();
        trade.end_price = 900_000 * D18.as_u128();
        assert!(trade.calculate_k(auction_length).is_ok());
        let k_10_percent = trade.k;

        trade.start_price = 1_000_000 * D18.as_u128();
        trade.end_price = 800_000 * D18.as_u128();
        assert!(trade.calculate_k(auction_length).is_ok());
        let k_20_percent = trade.k;

        assert!(k_20_percent.to_u256() > k_10_percent.to_u256());
    }

    #[test]
    fn test_get_price_is_not_ongoing() {
        let mut trade = setup_trade();
        trade.start = 1000;

        assert!(trade.get_price(500).is_err());
    }

    #[test]
    fn test_get_price() {
        let mut trade = setup_trade();
        trade.start = 1000;
        trade.end = 2000;

        trade.start_price = 1_000_000 * D18.as_u128();
        trade.end_price = 900_000 * D18.as_u128();
        trade.calculate_k(1000).unwrap();

        assert_eq!(trade.get_price(1000).unwrap(), 1_000_000 * D18.as_u128());
        assert_eq!(trade.get_price(2000).unwrap(), 900_000 * D18.as_u128());

        let mid_price = trade.get_price(1500).unwrap();
        assert!(mid_price < 1_000_000 * D18.as_u128());
        assert!(mid_price > 900_000 * D18.as_u128());

        assert!(trade.get_price(500).is_err());
        assert!(trade.get_price(2500).is_err());
    }

    #[test]
    fn test_get_price_flat_rate() {
        let mut trade = setup_trade();
        trade.start = 1000;
        trade.end = 2000;
        trade.start_price = 1_000_000;
        trade.end_price = 1_000_000;
        trade.calculate_k(1000).unwrap();

        assert_eq!(trade.get_price(1000).unwrap(), 1_000_000);
        assert_eq!(trade.get_price(1500).unwrap(), 1_000_000);
        assert_eq!(trade.get_price(2000).unwrap(), 1_000_000);
    }
}
