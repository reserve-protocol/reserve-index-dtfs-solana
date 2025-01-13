use crate::program::Folio as FolioProgram;
use crate::state::{Folio, Trade};
use anchor_lang::prelude::*;
use shared::constants::{MAX_PRICE_RANGE, MAX_RATE, SCALAR};
use shared::errors::ErrorCode;

use shared::util::math_util::{RoundingMode, SafeArithmetic};
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

    pub fn try_get_status(&self) -> Option<TradeStatus> {
        let current_time = Clock::get().unwrap().unix_timestamp as u64;

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

    pub fn open_trade(&mut self, folio: &Folio) -> Result<()> {
        let current_time = Clock::get()?.unix_timestamp as u64;

        let trade_status = self.try_get_status();

        check_condition!(
            trade_status.is_some() && trade_status.unwrap() == TradeStatus::APPROVED,
            TradeCannotBeOpened
        );

        // do not open trades that have timed out from ttl
        check_condition!(self.launch_timeout <= current_time, TradeTimeout);

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
        let price_ratio =
            self.start_price
                .mul_div_precision(SCALAR, self.end_price, RoundingMode::Floor);

        let ln_result = <u64 as SafeArithmetic>::natural_log(price_ratio);

        self.k = ln_result.checked_div(auction_length).unwrap();

        Ok(())
    }
}
