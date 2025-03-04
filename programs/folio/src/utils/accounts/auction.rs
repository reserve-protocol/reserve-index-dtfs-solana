use crate::program::Folio as FolioProgram;
use crate::state::{Auction, Folio};
use crate::utils::math_util::Decimal;
use crate::utils::structs::AuctionStatus;
use crate::utils::{AuctionEnd, BasketRange, Prices, Rounding};
use anchor_lang::prelude::*;
use shared::constants::{MAX_PRICE_RANGE, MAX_RATE, MAX_TTL};
use shared::errors::ErrorCode;
use shared::{check_condition, constants::AUCTION_SEEDS};
use std::cell::RefMut;
use std::cmp::max;

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
                    &[AUCTION_SEEDS, folio_pubkey.as_ref(), auction_id.as_ref()],
                    &FolioProgram::id()
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
        scaled_prices: &Prices,
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

    /// Validate the auction open action, done by the auction launcher.
    ///
    /// # Arguments
    /// * `scaled_start_price` - The scaled start price of the auction (D18).
    /// * `scaled_end_price` - The scaled end price of the auction (D18).
    /// * `scaled_sell_limit` - The scaled sell limit of the auction (D18).
    /// * `scaled_buy_limit` - The scaled buy limit of the auction (D18).
    pub fn validate_auction_opening_from_auction_launcher(
        &self,
        scaled_start_price: u128,
        scaled_end_price: u128,
        scaled_sell_limit: u128,
        scaled_buy_limit: u128,
    ) -> Result<()> {
        check_condition!(
            scaled_start_price >= self.prices.start
                && scaled_end_price >= self.prices.end
                && (self.prices.start == 0 || scaled_start_price <= 100 * self.prices.start),
            InvalidPrices
        );

        check_condition!(
            scaled_sell_limit >= self.sell_limit.low && scaled_sell_limit <= self.sell_limit.high,
            InvalidSellLimit
        );

        check_condition!(
            scaled_buy_limit >= self.buy_limit.low && scaled_buy_limit <= self.buy_limit.high,
            InvalidBuyLimit
        );

        Ok(())
    }

    /// Get the status of the auction.
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

    /// Open the auction.
    ///
    /// # Arguments
    /// * `folio` - The folio.
    /// * `current_time` - The current on-chain time (seconds).
    pub fn open_auction(&mut self, folio: &mut RefMut<'_, Folio>, current_time: u64) -> Result<()> {
        let auction_status = self.try_get_status(current_time);

        check_condition!(
            auction_status == Some(AuctionStatus::APPROVED),
            AuctionCannotBeOpened
        );

        // Do not open auctions that have timed out from ttl
        check_condition!(current_time <= self.launch_timeout, AuctionTimeout);

        // get the auction ends for the mints to see if there are any collisions
        let (sell_auction_end, buy_auction_end) =
            folio.get_auction_end_for_mints(&self.buy, &self.sell)?;

        // ensure no conflicting auctions by token
        // necessary to prevent dutch auctions from taking losses
        if let Some(sell_auction_end) = sell_auction_end {
            check_condition!(current_time > sell_auction_end.end_time, AuctionCollision);
        }

        if let Some(buy_auction_end) = buy_auction_end {
            check_condition!(current_time > buy_auction_end.end_time, AuctionCollision);
        }

        // now get the actual ends for the mints
        let current_time_with_auction_length = current_time + folio.auction_length;

        let (end_sell_time, end_buy_time) = {
            let (sell_auction_end, buy_auction_end) =
                folio.get_auction_end_for_mints(&self.sell, &self.buy)?;
            (
                sell_auction_end.unwrap_or(&AuctionEnd::default()).end_time,
                buy_auction_end.unwrap_or(&AuctionEnd::default()).end_time,
            )
        };

        folio.set_auction_end_for_mints(
            &self.sell,
            &self.buy,
            max(end_sell_time, current_time_with_auction_length),
            max(end_buy_time, current_time_with_auction_length),
        );

        // ensure valid price range (startPrice == endPrice is valid)
        check_condition!(
            self.prices.start >= self.prices.end
                && self.prices.end != 0
                && self.prices.start <= MAX_RATE
                && self
                    .prices
                    .start
                    .checked_div(self.prices.end)
                    .ok_or(ErrorCode::MathOverflow)?
                    <= MAX_PRICE_RANGE,
            InvalidPrices
        );

        self.start = current_time;
        self.end = current_time_with_auction_length;

        self.calculate_k(folio.auction_length)?;

        Ok(())
    }

    /// Calculate the k value for the auction. Used to avoid recomputing k on every bid.
    /// k = ln(P_0 / P_t) / t
    ///
    /// # Arguments
    /// * `auction_length` - The length of the auction (seconds).
    pub fn calculate_k(&mut self, auction_length: u64) -> Result<()> {
        let scaled_price_ratio = Decimal::from_scaled(self.prices.start)
            .mul(&Decimal::ONE_E18)?
            .div(&Decimal::from_scaled(self.prices.end))?;

        self.k = scaled_price_ratio
            .ln()?
            .unwrap()
            .div(&Decimal::from_scaled(auction_length))?
            .to_scaled(Rounding::Floor)?;

        Ok(())
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

                let scaled_time_value =
                    Decimal::from_scaled(self.k).mul(&Decimal::from_scaled(elapsed))?;

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
}
