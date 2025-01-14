use std::ops::{Div, Mul};

use crate::program::Folio as FolioProgram;
use crate::state::{Folio, Trade};
use anchor_lang::prelude::*;
use shared::constants::{MAX_PRICE_RANGE, MAX_RATE, SCALAR};
use shared::errors::ErrorCode;

use shared::util::math_util::SafeArithmetic;
use shared::{check_condition, constants::TRADE_SEEDS, structs::TradeStatus};

impl Trade {
    pub fn validate_trade(&self, trade_pubkey: &Pubkey, folio_pubkey: &Pubkey) -> Result<()> {
        let trade_id = self.id.to_le_bytes();

        check_condition!(
            (*trade_pubkey, self.bump)
                == Pubkey::find_program_address(
                    &[TRADE_SEEDS, folio_pubkey.as_ref(), trade_id.as_ref()],
                    &FolioProgram::id()
                ),
            InvalidPda
        );
        Ok(())
    }

    pub fn validate_trade_opening_from_trade_launcher(
        &self,
        start_price: u64,
        end_price: u64,
        sell_limit: u64,
        buy_limit: u64,
    ) -> Result<()> {
        check_condition!(
            start_price >= self.start_price
                && end_price >= self.end_price
                && (self.start_price == 0 || start_price <= 100 * self.start_price),
            InvalidPrices
        );

        check_condition!(
            sell_limit >= self.sell_limit.low && sell_limit <= self.sell_limit.high,
            InvalidSellLimit
        );

        check_condition!(
            buy_limit >= self.buy_limit.low && buy_limit <= self.buy_limit.high,
            InvalidBuyLimit
        );

        Ok(())
    }

    pub fn try_get_status(&self, current_time: u64) -> Option<TradeStatus> {
        if self.start == 0 && self.end == 0 {
            Some(TradeStatus::APPROVED)
        } else if self.start <= current_time && self.end >= current_time {
            Some(TradeStatus::Open)
        } else if self.end < current_time {
            Some(TradeStatus::Closed)
        } else {
            None
        }
    }

    pub fn open_trade(&mut self, folio: &Folio, current_time: u64) -> Result<()> {
        let trade_status = self.try_get_status(current_time);

        check_condition!(
            trade_status.is_some() && trade_status.unwrap() == TradeStatus::APPROVED,
            TradeCannotBeOpened
        );

        // do not open trades that have timed out from ttl
        check_condition!(current_time <= self.launch_timeout, TradeTimeout);

        let (sell_trade_end, buy_trade_end) =
            folio.get_trade_end_for_mint(&self.sell, &self.buy)?;

        // ensure no conflicting trades by token
        // necessary to prevent dutch auctions from taking losses
        if let Some(sell_trade_end) = sell_trade_end {
            check_condition!(current_time > sell_trade_end.end_time, TradeCollision);
        }

        if let Some(buy_trade_end) = buy_trade_end {
            check_condition!(current_time > buy_trade_end.end_time, TradeCollision);
        }

        // ensure valid price range (startPrice == endPrice is valid)
        check_condition!(
            self.start_price >= self.end_price
                && self.start_price != 0
                && self.end_price != 0
                && self.start_price <= MAX_RATE
                && self.start_price / self.end_price <= MAX_PRICE_RANGE,
            InvalidPrices
        );

        self.start = current_time;
        self.end = current_time + folio.auction_length;

        self.calculate_k(folio.auction_length)?;

        Ok(())
    }

    pub fn calculate_k(&mut self, auction_length: u64) -> Result<()> {
        if self.start_price == self.end_price {
            self.k = 0;
            return Ok(());
        }

        let price_ratio = (self.start_price as u128)
            .checked_mul(SCALAR as u128)
            .unwrap()
            .checked_div(self.end_price as u128)
            .unwrap();

        let ln_result = ((price_ratio as f64).div(SCALAR as f64))
            .ln()
            .mul(SCALAR as f64) as u64;

        self.k = ln_result.checked_div(auction_length).unwrap();

        Ok(())
    }

    pub fn get_price(&self, current_time: u64) -> Result<u128> {
        check_condition!(
            self.start <= current_time && self.end >= current_time,
            TradeNotOngoing
        );

        match current_time {
            i if i == self.start => Ok(self.start_price as u128),
            i if i == self.end => Ok(self.end_price as u128),
            _ => {
                let time_value = self
                    .k
                    .mul_precision_to_u128(current_time.checked_sub(self.start).unwrap());

                let scaled_time_value = (time_value as f64) / (SCALAR as f64);

                let time_value_exponent = (-scaled_time_value).exp();

                let p = (self.start_price as f64).mul(time_value_exponent) as u128;

                if p < self.end_price as u128 {
                    Ok(self.end_price as u128)
                } else {
                    Ok(p)
                }
            }
        }
    }
}
