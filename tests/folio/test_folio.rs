#[cfg(test)]
mod tests {
    use anchor_lang::prelude::*;
    use folio::state::Folio;
    use folio::utils::structs::TradeEnd;
    use shared::constants::{DAO_FEE_DENOMINATOR, MAX_FOLIO_FEE, MAX_MINTING_FEE};

    fn setup_folio() -> Folio {
        let mut folio = Folio::default();
        folio.minting_fee = MAX_MINTING_FEE;
        folio.folio_fee = MAX_FOLIO_FEE;
        folio.last_poke = 1000;
        folio
    }

    #[test]
    fn test_calculate_fees_for_minting() {
        let mut folio = setup_folio();
        let user_shares = 1_000_000_000_000; // 1000 shares
        let dao_fee_numerator = 500_000_000_000_000_000;
        let dao_fee_denominator = DAO_FEE_DENOMINATOR;

        let total_fee_shares = folio
            .calculate_fees_for_minting(user_shares, dao_fee_numerator, dao_fee_denominator)
            .unwrap();

        // Minting fee is 0.1 = 10%
        // Total fee = 1000 * 0.1 = 100 shares
        // Dao num/denom = 500_000_000_000_000_000/1_000_000_000_000_000_000 = 0.0005
        // DAO fee ~= 100 * 0.5 ~= 50 shares
        // Fee recipients ~= 50 shares
        assert_eq!(total_fee_shares, 100_000_000_000);
        assert_eq!(folio.dao_pending_fee_shares, 50_000_000_001);
        assert_eq!(folio.fee_recipients_pending_fee_shares, 49_999_999_999);
    }

    #[test]
    fn test_calculate_fees_with_min_dao_fee() {
        let mut folio = setup_folio();

        let user_shares = 1_000_000_000;
        let dao_fee_numerator = 200;
        let dao_fee_denominator = DAO_FEE_DENOMINATOR;

        let total_fee_shares = folio
            .calculate_fees_for_minting(user_shares, dao_fee_numerator, dao_fee_denominator)
            .unwrap();

        // Minting fee is 0.1 = 10%
        // Total fee = 1 * 0.1 = 0.1 shares
        // Dao num/denom = 0.0000002
        // DAO fee = 0.1 * 0.0000002 = 0.0000002 shares, but min is 0.0005 * 1 = 0.0005 shares
        // Fee recipients = 0.08 shares
        assert_eq!(folio.dao_pending_fee_shares, 500_000);
        assert_eq!(total_fee_shares, 100_000_000);
    }

    #[test]
    fn test_poke() {
        let mut folio = setup_folio();
        let initial_supply = 100_000_000_000; // 100 token supply
        let dao_fee_numerator = 1_000_000_000_000_000;
        let dao_fee_denominator = DAO_FEE_DENOMINATOR;

        folio
            .poke(initial_supply, 2000, dao_fee_numerator, dao_fee_denominator)
            .unwrap();

        assert_eq!(folio.last_poke, 2000);

        // With 1% fee over 1000 seconds, should have accumulated some fees
        assert!(folio.dao_pending_fee_shares > 0);
        assert!(folio.fee_recipients_pending_fee_shares > 0);
    }

    #[test]
    fn test_poke_same_timestamp() {
        let mut folio = setup_folio();
        let initial_supply = 1_000_000_000;
        let dao_fee_numerator = 500_000_000;
        let dao_fee_denominator = DAO_FEE_DENOMINATOR;

        folio
            .poke(initial_supply, 1000, dao_fee_numerator, dao_fee_denominator)
            .unwrap();

        // Verify no changes occurred
        assert_eq!(folio.last_poke, 1000);
        assert_eq!(folio.dao_pending_fee_shares, 0);
        assert_eq!(folio.fee_recipients_pending_fee_shares, 0);
    }

    #[test]
    fn test_get_total_supply() {
        let mut folio = setup_folio();
        let initial_supply = 1_000_000_000;

        folio.dao_pending_fee_shares = 10_000_000;
        folio.fee_recipients_pending_fee_shares = 20_000_000;

        let total_supply = folio.get_total_supply(initial_supply).unwrap();

        assert_eq!(total_supply, 1_030_000_000);
    }

    #[test]
    fn test_get_pending_fee_shares() {
        let mut folio = setup_folio();
        folio.last_poke = 1000;
        folio.folio_fee = MAX_FOLIO_FEE; // 50% annually

        let initial_supply = 1_000_000_000_000u64; // 1000 tokens
        let current_time = 2000; // 1000 seconds elapsed
        let dao_fee_numerator = 400_000_000_000_000_000;
        let dao_fee_denominator = DAO_FEE_DENOMINATOR;

        let (fee_recipients_shares, dao_shares) = folio
            .get_pending_fee_shares(
                initial_supply,
                current_time,
                dao_fee_numerator,
                dao_fee_denominator,
            )
            .unwrap();

        assert!(fee_recipients_shares > 0);
        assert!(dao_shares > 0);

        let total_fees = fee_recipients_shares + dao_shares;
        let dao_portion = (dao_shares as u128 * 1_000_000_000) / total_fees as u128;

        assert!(dao_portion >= 390_000_000); // Allow 39%
        assert!(dao_portion <= 410_000_000); // Allow 41%
    }

    #[test]
    fn test_get_trade_end_for_mint() {
        let mut folio = setup_folio();
        let mint_a = Pubkey::new_unique();
        let mint_b = Pubkey::new_unique();
        let mint_c = Pubkey::new_unique();

        folio.trade_ends[0] = TradeEnd {
            mint: mint_a,
            end_time: 100,
        };
        folio.trade_ends[4] = TradeEnd {
            mint: mint_b,
            end_time: 200,
        };

        let (sell_trade, buy_trade) = folio.get_trade_end_for_mint(&mint_a, &mint_b).unwrap();
        assert_eq!(sell_trade.unwrap().end_time, 100);
        assert_eq!(buy_trade.unwrap().end_time, 200);

        let (sell_trade, buy_trade) = folio.get_trade_end_for_mint(&mint_c, &mint_b).unwrap();
        assert!(sell_trade.is_none());
        assert_eq!(buy_trade.unwrap().end_time, 200);
    }

    #[test]
    fn test_set_trade_end_for_mints() {
        let mut folio = setup_folio();
        let mint_a = Pubkey::new_unique();
        let mint_b = Pubkey::new_unique();

        folio.trade_ends[0] = TradeEnd {
            mint: mint_a,
            end_time: 100,
        };
        folio.trade_ends[4] = TradeEnd {
            mint: mint_b,
            end_time: 200,
        };

        folio.set_trade_end_for_mints(&mint_a, &mint_b, 300);

        assert_eq!(folio.trade_ends[0].end_time, 300);
        assert_eq!(folio.trade_ends[4].end_time, 300);
    }
}
