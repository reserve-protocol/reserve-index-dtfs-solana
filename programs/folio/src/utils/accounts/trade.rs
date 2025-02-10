use crate::program::Folio as FolioProgram;
use crate::state::{Folio, Trade};
use crate::utils::Range;
use anchor_lang::prelude::*;
use shared::constants::{D18, MAX_PRICE_RANGE, MAX_RATE, MAX_TTL};
use shared::errors::ErrorCode;

use crate::utils::math_util::{CustomPreciseNumber, U256Number};
use crate::utils::structs::TradeStatus;
use shared::{check_condition, constants::TRADE_SEEDS};

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

    pub fn validate_trade_approve(
        sell_limit: &Range,
        buy_limit: &Range,
        start_price: u128,
        end_price: u128,
        ttl: u64,
    ) -> Result<()> {
        check_condition!(
            sell_limit.spot <= MAX_RATE
                && sell_limit.high <= MAX_RATE
                && sell_limit.low <= sell_limit.spot
                && sell_limit.high >= sell_limit.spot,
            InvalidSellLimit
        );

        check_condition!(
            buy_limit.spot != 0
                && buy_limit.spot <= MAX_RATE
                && buy_limit.high <= MAX_RATE
                && buy_limit.low <= buy_limit.spot
                && buy_limit.high >= buy_limit.spot,
            InvalidBuyLimit
        );

        check_condition!(start_price >= end_price, InvalidPrices);

        check_condition!(ttl >= MAX_TTL, InvalidTtl);

        Ok(())
    }

    pub fn validate_trade_opening_from_trade_launcher(
        &self,
        start_price: u128,
        end_price: u128,
        sell_limit: u128,
        buy_limit: u128,
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
            self.k = U256Number::ZERO;
            return Ok(());
        }

        let price_ratio = CustomPreciseNumber::from_u128(self.start_price)?
            .mul_generic(D18)?
            .div_generic(self.end_price)?;

        self.k = price_ratio
            .ln()?
            .unwrap()
            .div_generic(auction_length)?
            .as_u256_number();

        Ok(())
    }

    pub fn get_price(&self, current_time: u64) -> Result<u128> {
        check_condition!(
            self.start <= current_time && self.end >= current_time,
            TradeNotOngoing
        );

        match current_time {
            i if i == self.start => Ok(self.start_price),
            i if i == self.end => Ok(self.end_price),
            _ => {
                let time_value = self.k.to_custom_precise_number().mul_generic(
                    current_time
                        .checked_sub(self.start)
                        .ok_or(ErrorCode::MathOverflow)?,
                )?;

                //(-time_value).exp()
                let time_value_exponent = time_value.exp(true)?.unwrap();

                let p = CustomPreciseNumber::from_u128(self.start_price)?
                    .mul_generic(time_value_exponent)?
                    .div_generic(D18)?
                    .to_u128_floor()?;

                if p < self.end_price {
                    Ok(self.end_price)
                } else {
                    Ok(p)
                }
            }
        }
    }
}
