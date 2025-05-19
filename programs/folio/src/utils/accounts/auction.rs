use crate::state::{Auction, AuctionEnds, Folio, FolioBasket, Rebalance};
use crate::utils::structs::AuctionStatus;
use crate::utils::{BasketRange, OpenAuctionConfig, PricesInAuction};
use anchor_lang::prelude::*;
use shared::constants::{MAX_RATE, MAX_TTL};
use shared::errors::ErrorCode;
use shared::utils::math_util::Decimal;
use shared::utils::Rounding;
use shared::{check_condition, constants::AUCTION_SEEDS};
use std::cell::RefMut;

impl Auction {
    /// Validate the auction PDA.
    ///
    /// # Arguments
    /// * `auction_pubkey` - The pubkey of the auction.
    /// * `folio_pubkey` - The pubkey of the folio.
    pub fn validate_auction(&self, auction_pubkey: &Pubkey, folio_pubkey: &Pubkey) -> Result<()> {
        let auction_id = self.id.to_le_bytes();

        check_condition!(
            (*auction_pubkey, self.bump)
                == Pubkey::find_program_address(
                    &[
                        AUCTION_SEEDS,
                        folio_pubkey.as_ref(),
                        self.nonce.to_le_bytes().as_ref(),
                        auction_id.as_ref()
                    ],
                    &crate::id()
                ),
            InvalidPda
        );
        Ok(())
    }

    /// Validate the auction approve action.
    ///
    /// # Arguments
    /// * `scaled_sell_limit` - The basket range for the sell limit (D18).
    /// * `scaled_buy_limit` - The basket range for the buy limit (D18).
    /// * `scaled_prices` - The prices of the auction (D18).
    /// * `ttl` - The time to live of the auction (seconds).
    pub fn validate_auction_approve(
        scaled_sell_limit: &BasketRange,
        scaled_buy_limit: &BasketRange,
        scaled_prices: &PricesInAuction,
        ttl: u64,
    ) -> Result<()> {
        check_condition!(
            scaled_sell_limit.high <= MAX_RATE
                && scaled_sell_limit.low <= scaled_sell_limit.spot
                && scaled_sell_limit.high >= scaled_sell_limit.spot,
            InvalidSellLimit
        );

        check_condition!(
            scaled_buy_limit.spot != 0
                && scaled_buy_limit.high <= MAX_RATE
                && scaled_buy_limit.low <= scaled_buy_limit.spot
                && scaled_buy_limit.high >= scaled_buy_limit.spot,
            InvalidBuyLimit
        );

        check_condition!(scaled_prices.start >= scaled_prices.end, InvalidPrices);

        check_condition!(ttl <= MAX_TTL, InvalidTtl);

        Ok(())
    }

    /// Open the auction.
    ///
    /// # Arguments
    /// * `folio` - The folio.
    /// * `current_time` - The current on-chain time (seconds).
    pub fn open_auction(
        &mut self,
        folio: &mut RefMut<'_, Folio>,
        folio_basket: &FolioBasket,
        auction_ends: &mut AuctionEnds,
        raw_folio_token_supply: u64,
        rebalance: &mut RefMut<'_, Rebalance>,
        sell_mint: &Pubkey,
        buy_mint: &Pubkey,
        current_time: u64,
        auction_buffer: u64,
        // When the auction is launched permission less, config is always None.
        config: Option<OpenAuctionConfig>,
        is_permissionless: bool,
    ) -> Result<()> {
        // Do not open auctions that have timed out from ttl
        check_condition!(current_time <= rebalance.available_until, AuctionTimeout);

        let (sell_details, buy_details) = rebalance.get_token_details_pair(sell_mint, buy_mint);
        check_condition!(
            sell_details.is_some() && buy_details.is_some(),
            TokensNotAvailableForRebalance
        );

        let sell_details = sell_details.unwrap();
        let buy_details = buy_details.unwrap();

        let is_price_deferred = buy_details.prices.low == 0;

        if is_permissionless {
            // Only open auctions that have not timed out (ttl check) and are available to be opened permissionlessly.
            check_condition!(
                current_time >= rebalance.restricted_until
                    && current_time <= rebalance.available_until,
                AuctionCannotBeOpenedPermissionlesslyYet
            );
            // If any price is non-zero, all are non-zero.
            check_condition!(
                !is_price_deferred,
                AuctionCannotBeOpenedPermissionlesslyWithDeferredPrice
            );
        }
        check_condition!(
            current_time >= rebalance.started_at + auction_buffer
                && current_time <= rebalance.available_until
                && rebalance.rebalance_ready(),
            FolioNotRebalancing
        );

        // confirm no auction collision on token pair
        {
            check_condition!(
                current_time > auction_ends.end_time + auction_buffer,
                AuctionCollision
            );
        }

        let auction_spot_sell_limit = match config {
            Some(config) => config.sell_limit_spot,
            None => sell_details.limits.spot,
        };

        let auction_spot_buy_limit = match config {
            Some(config) => config.buy_limit_spot,
            None => buy_details.limits.spot,
        };

        check_condition!(
            auction_spot_sell_limit >= sell_details.limits.low
                && auction_spot_sell_limit <= sell_details.limits.high,
            InvalidSellLimit
        );
        check_condition!(
            auction_spot_buy_limit >= buy_details.limits.low
                && auction_spot_buy_limit <= buy_details.limits.high,
            InvalidBuyLimit
        );

        // Confirm sell is surplus and buy is deficit
        {
            let scaled_folio_token_total_supply = folio.get_total_supply(raw_folio_token_supply)?;
            // {sellTok} = D18{sellTok/share} * {share} / D18
            let sell_tokens = scaled_folio_token_total_supply
                .mul(&Decimal::from_scaled(auction_spot_sell_limit))?
                .div(&Decimal::ONE_E18)?
                .to_scaled(Rounding::Floor)?;

            let balance: u128 = folio_basket
                .get_token_amount_in_folio_basket(sell_mint)?
                .into();

            check_condition!(balance > sell_tokens, SellTokenNotSurplus);

            // Confirm buy is deficit
            let buy_tokens = scaled_folio_token_total_supply
                .mul(&Decimal::from_scaled(auction_spot_buy_limit))?
                .div(&Decimal::ONE_E18)?
                .to_scaled(Rounding::Ceiling)?;

            let balance: u128 = folio_basket
                .get_token_amount_in_folio_basket_or_zero(buy_mint)
                .into();

            check_condition!(balance < buy_tokens, BuyTokenNotDeficit);
        }

        let auction_price = if is_price_deferred {
            check_condition!(
                config.is_some(),
                AuctionCannotBeOpenedPermissionlesslyWithDeferredPrice
            );
            config.unwrap().price
        } else {
            // D27{buyTok/sellTok} = D27 * D27{UoA/sellTok} / D27{UoA/buyTok}
            let old_start_price = Decimal::from_scaled(sell_details.prices.high)
                .mul(&Decimal::ONE_E18)?
                .div(&Decimal::from_scaled(buy_details.prices.low))?
                .to_scaled(Rounding::Ceiling)?;

            let old_end_price = Decimal::from_scaled(sell_details.prices.low)
                .mul(&Decimal::ONE_E18)?
                .div(&Decimal::from_scaled(buy_details.prices.high))?
                .to_scaled(Rounding::Ceiling)?;

            match config {
                Some(config) => {
                    let prices = config.price;

                    check_condition!(
                        prices.start >= old_start_price
                         // allow up to 100x increase
                         && prices.start <= 100 * old_start_price
                         && prices.end >= old_end_price,
                        InvalidPrices
                    );

                    prices
                }
                None => PricesInAuction {
                    start: old_start_price,
                    end: old_end_price,
                },
            }
        };

        // update spot limits to prevent double trading in the future by openAuctionUnrestricted()
        {
            let (sell_details, buy_details) =
                rebalance.get_token_details_pair_mut(sell_mint, buy_mint);
            let sell_details = sell_details.unwrap();
            let buy_details = buy_details.unwrap();

            sell_details.limits.spot = auction_spot_sell_limit;
            buy_details.limits.spot = auction_spot_buy_limit;

            // update low/high limits to prevent double trading in the future by openAuction()
            sell_details.limits.high = auction_spot_sell_limit;
            buy_details.limits.low = auction_spot_buy_limit;
            // by lowering the high sell limit the AUCTION_LAUNCHER cannot backtrack and later buy the sellToken
            // by raising the low buy limit the AUCTION_LAUNCHER cannot backtrack and later sell the buyToken
            // intentional: by leaving the other 2 limits unchanged (sell.low and buy.high) there can be future
            //              auctions to trade FURTHER, incase current auctions go better than expected
        }

        // Set auction values
        let auction_index = rebalance.get_next_auction_id();
        self.id = auction_index;
        self.nonce = rebalance.nonce;
        self.sell_mint = *sell_mint;
        self.buy_mint = *buy_mint;
        self.start = current_time;
        self.end = current_time + folio.auction_length;
        self.prices = auction_price;
        self.sell_limit = auction_spot_sell_limit;
        self.buy_limit = auction_spot_buy_limit;
        rebalance.current_auction_id = auction_index;
        auction_ends.end_time = current_time + self.auction_length()?;

        Ok(())
    }

    /// Get the status of the last running auction.
    ///
    /// # Arguments
    /// * `current_time` - The current on-chain time (seconds).
    ///
    /// # Returns
    /// * `Some(AuctionStatus)` - The status of the auction.
    /// * `None` - If no status can be determined.
    pub fn try_get_status(&self, current_time: u64) -> Option<AuctionStatus> {
        if self.start == 0 && self.end == 0 {
            Some(AuctionStatus::APPROVED)
        } else if self.start <= current_time && self.end >= current_time {
            Some(AuctionStatus::Open)
        } else if self.end < current_time {
            Some(AuctionStatus::Closed)
        } else {
            None
        }
    }
    /// Calculate the k value for the auction. Used to avoid recomputing k on every bid.
    /// k = ln(P_0 / P_t) / t
    /// Only public for testing.
    pub fn calculate_k(&self) -> Result<u128> {
        let auction_length = self.auction_length()?;
        let scaled_price_ratio = Decimal::from_scaled(self.prices.start)
            .mul(&Decimal::ONE_E18)?
            .div(&Decimal::from_scaled(self.prices.end))?;

        let k = scaled_price_ratio
            .ln()?
            .unwrap()
            .div(&Decimal::from_scaled(auction_length))?
            .to_scaled(Rounding::Floor)?;

        Ok(k)
    }

    pub fn auction_length(&self) -> Result<u64> {
        Ok(self
            .end
            .checked_sub(self.start)
            .ok_or(ErrorCode::MathOverflow)?)
    }

    /// Get the price of the auction at a given time.
    /// P_t = P_0 * e ^ -kt
    /// D18{buyTok/sellTok} = D18{buyTok/sellTok} * D18{1} / D18
    ///
    /// # Arguments
    /// * `current_time` - The current on-chain time (seconds).
    ///
    /// # Returns
    /// * `u128` - The price of the auction at the given time (D18{buyTok/sellTok}).
    pub fn get_price(&self, current_time: u64) -> Result<u128> {
        // ensure auction is ongoing
        check_condition!(
            current_time >= self.start && current_time <= self.end,
            AuctionNotOngoing
        );

        match current_time {
            i if i == self.start => Ok(self.prices.start),
            i if i == self.end => Ok(self.prices.end),
            _ => {
                let elapsed = current_time
                    .checked_sub(self.start)
                    .ok_or(ErrorCode::MathOverflow)?;

                let k = self.calculate_k()?;

                let scaled_time_value =
                    Decimal::from_scaled(k).mul(&Decimal::from_scaled(elapsed))?;

                //(-time_value).exp()
                let scaled_time_value_exponent = scaled_time_value.exp(true)?.unwrap();

                let scaled_p = Decimal::from_scaled(self.prices.start)
                    .mul(&scaled_time_value_exponent)?
                    .div(&Decimal::ONE_E18)?
                    .to_scaled(Rounding::Ceiling)?;

                if scaled_p < self.prices.end {
                    Ok(self.prices.end)
                } else {
                    Ok(scaled_p)
                }
            }
        }
    }

    /// return (sell_amount, bid_amount, price D18{buyTok/sellTok}, scaled_folio_token_total_supply)
    pub fn get_bid(
        &self,
        folio: &Folio,
        folio_basket: &FolioBasket,
        raw_folio_token_supply: u64,
        current_time: u64,
        raw_sell_amount: u64,
        raw_max_buy_amount: u64,
    ) -> Result<(u64, u64, Decimal, Decimal)> {
        // D18{buyTok/sellTok}
        let scaled_price = Decimal::from_scaled(self.get_price(current_time)?);

        // totalSupply inflates over time due to TVL fee, causing buyLimits/sellLimits to be slightly stale
        let scaled_folio_token_total_supply = folio.get_total_supply(raw_folio_token_supply)?;

        let raw_sell_balance = folio_basket.get_token_amount_in_folio_basket(&self.sell_mint)?;
        // {sellTok} = D18{sellTok/share} * {share} / D18
        let raw_limit_sell_balance = Decimal::from_scaled(self.sell_limit)
            .mul(&scaled_folio_token_total_supply)?
            .div(&Decimal::ONE_E18)?
            .to_token_amount(Rounding::Ceiling)?
            .0;

        let raw_sell_available = raw_sell_balance.saturating_sub(raw_limit_sell_balance);

        let raw_buy_balance = folio_basket.get_token_amount_in_folio_basket_or_zero(&self.buy_mint);
        //  D18{buyTok/share} = D18{buyTok/share} * {share} / D18

        let buy_limit_balance = Decimal::from_scaled(self.buy_limit)
            .mul(&scaled_folio_token_total_supply)?
            .div(&Decimal::ONE_E18)?
            .to_token_amount(Rounding::Floor)?
            .0;
        let buy_amount_available = buy_limit_balance.saturating_sub(raw_buy_balance);

        // Calculate the sell amount from the buy amount
        // {sellTok} = {buyTok} * D18 / D18{buyTok/sellTok}
        let sell_amount_available_from_buy = Decimal::from_token_amount(buy_amount_available)?
            .mul(&Decimal::ONE_E18)?
            .div(&scaled_price)?
            .to_token_amount(Rounding::Floor)?
            .0;
        let sell_amount_available = sell_amount_available_from_buy.min(raw_sell_available);

        // bidAmount
        let bid_amount = Decimal::from_token_amount(sell_amount_available)?
            .mul(&scaled_price)?
            .div(&Decimal::ONE_E18)?
            .to_token_amount(Rounding::Floor)?
            .0;

        check_condition!(
            sell_amount_available >= raw_sell_amount,
            InsufficientBalance
        );
        check_condition!(
            bid_amount != 0 && bid_amount <= raw_max_buy_amount,
            SlippageExceeded
        );

        Ok((
            sell_amount_available,
            bid_amount,
            scaled_price,
            scaled_folio_token_total_supply,
        ))
    }
}
