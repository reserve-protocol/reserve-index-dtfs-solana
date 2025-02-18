use crate::utils::math_util::Decimal;
use crate::utils::structs::{AuctionEnd, FolioStatus, Role};
use crate::utils::{Rounding, TokenResult};
use crate::{
    events::TVLFeeSet,
    program::Folio as FolioProgram,
    state::{Actor, Folio},
};
use anchor_lang::prelude::*;
use shared::constants::YEAR_IN_SECONDS;
use shared::{
    check_condition,
    constants::{FOLIO_SEEDS, MAX_TVL_FEE},
    errors::ErrorCode,
};

impl Folio {
    #[allow(clippy::too_many_arguments)]
    pub fn validate_folio(
        &self,
        folio_pubkey: &Pubkey,
        actor: Option<&Account<'_, Actor>>,
        required_roles: Option<Vec<Role>>,
        expected_statuses: Option<Vec<FolioStatus>>,
    ) -> Result<()> {
        // Validate folio seeds & bump
        let folio_token_mint = self.folio_token_mint.key();
        check_condition!(
            (*folio_pubkey, self.bump)
                == Pubkey::find_program_address(
                    &[FOLIO_SEEDS, folio_token_mint.as_ref()],
                    &FolioProgram::id()
                ),
            InvalidPda
        );

        // Validate Role if needed
        if let (Some(actor), Some(required_roles)) = (actor, required_roles) {
            Folio::validate_permission_for_action(actor, required_roles)?;
        }

        // Validate folio status
        if let Some(expected_statuses) = expected_statuses {
            check_condition!(
                expected_statuses.contains(&FolioStatus::from(self.status)),
                InvalidFolioStatus
            );
        }

        Ok(())
    }

    fn validate_permission_for_action(
        actor: &Account<'_, Actor>,
        required_roles: Vec<Role>,
    ) -> Result<()> {
        let mut has_one_of_the_roles = false;

        for required_role in required_roles {
            if Role::has_role(actor.roles, required_role) {
                has_one_of_the_roles = true;
                break;
            }
        }

        check_condition!(has_one_of_the_roles, InvalidRole);

        Ok(())
    }

    pub fn set_tvl_fee(&mut self, new_fee_annually: u128) -> Result<()> {
        // Annual fee is in D18
        check_condition!(new_fee_annually <= MAX_TVL_FEE, TVLFeeTooHigh);

        if new_fee_annually == 0 {
            self.tvl_fee = 0;
            emit!(TVLFeeSet { new_fee: 0 });
            return Ok(());
        }

        // convert annual percentage to per-second
        // = 1 - (1 - _newFeeAnnually) ^ (1 / 31536000)
        // D18{1/s} = D18{1} - D18{1} ^ {s}
        let one_minus_fee = Decimal::ONE_E18.sub(&Decimal::from_scaled(new_fee_annually))?;
        let result = one_minus_fee.nth_root(YEAR_IN_SECONDS)?;
        let tvl_fee = Decimal::ONE_E18.sub(&result)?;

        check_condition!(
            new_fee_annually == 0 || tvl_fee != Decimal::ZERO,
            TVLFeeTooLow
        );

        self.tvl_fee = tvl_fee.to_scaled(Rounding::Floor)?;

        emit!(TVLFeeSet {
            new_fee: self.tvl_fee,
        });

        Ok(())
    }

    /// Returns the total number of shares to remove from the mint, and updates the ones on the folio
    pub fn calculate_fees_for_minting(
        &mut self,
        user_shares: u64,          // D9
        dao_fee_numerator: u128,   // D18
        dao_fee_denominator: u128, // D18
        dao_fee_floor: u128,       // D18
    ) -> Result<TokenResult> // D9
    {
        let decimal_user_shares = Decimal::from_token_amount(user_shares)?;
        let decimal_mint_fee = Decimal::from_scaled(self.mint_fee);

        let decimal_dao_fee_numerator = Decimal::from_scaled(dao_fee_numerator);
        let decimal_dao_fee_denominator = Decimal::from_scaled(dao_fee_denominator);
        let decimal_dao_fee_floor = Decimal::from_scaled(dao_fee_floor);

        let mut total_fee_shares = decimal_user_shares
            // Minting fee is already scaled by D18
            .mul(&decimal_mint_fee)?
            .add(&Decimal::ONE_E18)?
            .sub(&Decimal::ONE)?
            .div(&Decimal::ONE_E18)?;

        let mut dao_fee_shares = total_fee_shares
            .mul(&decimal_dao_fee_numerator)?
            .add(&decimal_dao_fee_denominator)?
            .sub(&Decimal::ONE)?
            .div(&decimal_dao_fee_denominator)?;

        let min_dao_shares = decimal_user_shares
            .mul(&decimal_dao_fee_floor)?
            .add(&Decimal::ONE_E18)?
            .sub(&Decimal::ONE)?
            .div(&Decimal::ONE_E18)?;

        if dao_fee_shares < min_dao_shares {
            dao_fee_shares = min_dao_shares;
        }

        if total_fee_shares < dao_fee_shares {
            total_fee_shares = dao_fee_shares.clone();
        }

        self.dao_pending_fee_shares = self
            .dao_pending_fee_shares
            .checked_add(dao_fee_shares.to_scaled(Rounding::Floor)?)
            .ok_or(ErrorCode::MathOverflow)?;

        self.fee_recipients_pending_fee_shares = self
            .fee_recipients_pending_fee_shares
            .checked_add(
                total_fee_shares
                    .sub(&dao_fee_shares)?
                    .to_scaled(Rounding::Floor)?,
            )
            .ok_or(ErrorCode::MathOverflow)?;

        total_fee_shares.to_token_amount(Rounding::Ceiling)
    }

    pub fn poke(
        &mut self,
        folio_token_supply: u64, // D9
        current_time: i64,
        dao_fee_numerator: u128,   // D18
        dao_fee_denominator: u128, // D18
        dao_fee_floor: u128,       // D18
    ) -> Result<()> {
        if current_time.saturating_sub(self.last_poke) == 0 {
            return Ok(());
        }

        let (fee_recipients_pending_fee, dao_pending_fee_shares) = self.get_pending_fee_shares(
            folio_token_supply,
            current_time,
            dao_fee_numerator,
            dao_fee_denominator,
            dao_fee_floor,
        )?;

        self.dao_pending_fee_shares = self
            .dao_pending_fee_shares
            .checked_add(dao_pending_fee_shares.to_scaled(Rounding::Floor)?)
            .ok_or(ErrorCode::MathOverflow)?;

        self.fee_recipients_pending_fee_shares = self
            .fee_recipients_pending_fee_shares
            .checked_add(fee_recipients_pending_fee.to_scaled(Rounding::Floor)?)
            .ok_or(ErrorCode::MathOverflow)?;

        self.last_poke = current_time;

        Ok(())
    }

    pub fn get_total_supply(
        &self,
        folio_token_supply: u64, // D9
    ) -> Result<Decimal> {
        // Total supply is in D9, since it's the default decimal mint for our folio token
        let total_supply = Decimal::from_token_amount(folio_token_supply)?;

        total_supply
            .add(&Decimal::from_scaled(self.dao_pending_fee_shares))?
            .add(&Decimal::from_scaled(
                self.fee_recipients_pending_fee_shares,
            ))
    }

    pub fn get_pending_fee_shares(
        &self,
        folio_token_supply: u64, // D9
        current_time: i64,
        dao_fee_numerator: u128,   // D18
        dao_fee_denominator: u128, // D18
        dao_fee_floor: u128,       // D18
    ) -> Result<(Decimal, Decimal)> {
        let total_supply_with_pending_fees = self.get_total_supply(folio_token_supply)?;

        let elapsed = (current_time - self.last_poke) as u64;

        // Calculate fee floor
        let one_minus_fee_floor = Decimal::ONE_E18.sub(&Decimal::from_scaled(dao_fee_floor))?;

        let fee_floor = Decimal::ONE_E18.sub(&one_minus_fee_floor.nth_root(YEAR_IN_SECONDS)?)?;

        // Use higher of fee floor or TVL fee
        let decimal_tvl_fee = Decimal::from_scaled(self.tvl_fee);
        let tvl_fee_to_use = if fee_floor > decimal_tvl_fee {
            fee_floor.clone()
        } else {
            decimal_tvl_fee
        };

        // Calculate fee shares
        let one_minus_tvl_fee = Decimal::ONE_E18.sub(&tvl_fee_to_use)?;
        let denominator = one_minus_tvl_fee.pow(elapsed)?;
        let fee_shares = total_supply_with_pending_fees
            .mul(&Decimal::ONE_E18)?
            .div(&denominator)?
            .sub(&total_supply_with_pending_fees)?;

        // Calculate correction
        let correction = fee_floor
            .mul(&Decimal::ONE_E18)?
            .add(&tvl_fee_to_use)?
            .sub(&Decimal::ONE)?
            .div(&tvl_fee_to_use)?;

        // Calculate DAO ratio
        let dao_ratio = Decimal::from_scaled(dao_fee_numerator)
            .mul(&Decimal::ONE_E18)?
            .add(&Decimal::from_scaled(dao_fee_denominator))?
            .sub(&Decimal::ONE)?
            .div(&Decimal::from_scaled(dao_fee_denominator))?;

        // Calculate DAO shares
        let dao_shares = if correction > dao_ratio {
            fee_shares
                .mul(&correction)?
                .add(&Decimal::ONE_E18)?
                .sub(&Decimal::ONE)?
                .div(&Decimal::ONE_E18)?
        } else {
            fee_shares
                .mul(&Decimal::from_scaled(dao_fee_numerator))?
                .add(&Decimal::from_scaled(dao_fee_denominator))?
                .sub(&Decimal::ONE)?
                .div(&Decimal::from_scaled(dao_fee_denominator))?
        };

        // Calculate fee recipient shares
        let fee_recipient_shares = fee_shares.sub(&dao_shares)?;

        Ok((fee_recipient_shares, dao_shares))
    }

    pub fn get_auction_end_for_mints(
        &self,
        sell_mint: &Pubkey,
        buy_mint: &Pubkey,
    ) -> Result<(Option<&AuctionEnd>, Option<&AuctionEnd>)> {
        let mut sell_auction = None;
        let mut buy_auction = None;

        for auction_end in self.sell_ends.iter() {
            if auction_end.mint == *sell_mint {
                sell_auction = Some(auction_end);
                break;
            }
        }

        for auction_end in self.buy_ends.iter() {
            if auction_end.mint == *buy_mint {
                buy_auction = Some(auction_end);
                break;
            }
        }

        Ok((sell_auction, buy_auction))
    }

    pub fn set_auction_end_for_mints(
        &mut self,
        sell_mint: &Pubkey,
        buy_mint: &Pubkey,
        end_time_sell: u64,
        end_time_buy: u64,
    ) {
        for auction_end in self.sell_ends.iter_mut() {
            if auction_end.mint == *sell_mint {
                auction_end.end_time = end_time_sell;
            }
        }

        for auction_end in self.buy_ends.iter_mut() {
            if auction_end.mint == *buy_mint {
                auction_end.end_time = end_time_buy;
            }
        }
    }
}
