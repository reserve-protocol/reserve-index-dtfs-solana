use crate::utils::structs::{AuctionEnd, FolioStatus, Role};
use crate::{
    events::TVLFeeSet,
    program::Folio as FolioProgram,
    state::{Actor, Folio},
};
use anchor_lang::prelude::*;
use shared::constants::YEAR_IN_SECONDS;
use shared::utils::math_util::Decimal;
use shared::utils::{Rounding, TokenResult};
use shared::{
    check_condition,
    constants::{FOLIO_SEEDS, MAX_TVL_FEE},
    errors::ErrorCode,
};

impl Folio {
    /// Validate the folio.
    /// Checks done will be:
    /// - PDA validation
    /// - Role validation if needed
    /// - Status validation if needed
    ///
    /// # Arguments
    /// * `folio_pubkey` - The pubkey of the folio.
    /// * `actor` - The actor account that is performing the action.
    /// * `required_roles` - The required roles for the action, can be ANY of the ones provided.
    /// * `expected_statuses` - The expected statuses for the folio, can be ANY of the ones provided.
    #[allow(clippy::too_many_arguments)]
    #[cfg(not(tarpaulin_include))]
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

    /// Validate the permission for an action by using the roles.
    ///
    /// # Arguments
    /// * `actor` - The actor account that is performing the action.
    /// * `required_roles` - The required roles for the action, can be ANY of the ones provided.
    #[cfg(not(tarpaulin_include))]
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

    /// Set TVL fee by annual percentage. Different from how it is stored!
    ///
    /// # Arguments
    /// * `scaled_new_fee_annually` - The new TVL fee D18{1}.
    pub fn set_tvl_fee(&mut self, scaled_new_fee_annually: u128) -> Result<()> {
        check_condition!(scaled_new_fee_annually <= MAX_TVL_FEE, TVLFeeTooHigh);

        if scaled_new_fee_annually == 0 {
            self.tvl_fee = 0;

            emit!(TVLFeeSet { new_fee: 0 });

            return Ok(());
        }

        // convert annual percentage to per-second
        // = 1 - (1 - _newFeeAnnually) ^ (1 / 31536000)
        // D18{1/s} = D18{1} - D18{1} ^ {s}
        let one_minus_fee = Decimal::ONE_E18.sub(&Decimal::from_scaled(scaled_new_fee_annually))?;

        let result = one_minus_fee.nth_root(YEAR_IN_SECONDS)?;

        let scaled_tvl_fee = Decimal::ONE_E18.sub(&result)?;

        check_condition!(
            scaled_new_fee_annually == 0 || scaled_tvl_fee != Decimal::ZERO,
            TVLFeeTooLow
        );

        self.tvl_fee = scaled_tvl_fee.to_scaled(Rounding::Floor)?;

        emit!(TVLFeeSet {
            new_fee: self.tvl_fee,
        });

        Ok(())
    }

    /// Returns the total number of shares to remove from the user's mint action (the fees),
    /// and updates the pending fee amounts on the folio.
    ///
    /// # Arguments
    /// * `raw_user_shares` - The number of shares the user is minting (D9).
    /// * `scaled_dao_fee_numerator` - The numerator of the DAO fee (D18).
    /// * `scaled_dao_fee_denominator` - The denominator of the DAO fee (D18).
    /// * `scaled_dao_fee_floor` - The floor of the DAO fee (D18).
    ///
    /// # Returns
    /// * `TokenResult` - The number of shares to remove from the user's mint action (the total fees, in D9).
    pub fn calculate_fees_for_minting(
        &mut self,
        raw_user_shares: u64,
        scaled_dao_fee_numerator: u128,
        scaled_dao_fee_denominator: u128,
        scaled_dao_fee_floor: u128,
    ) -> Result<TokenResult> {
        let scaled_user_shares = Decimal::from_token_amount(raw_user_shares)?;
        let scaled_mint_fee = Decimal::from_scaled(self.mint_fee);

        let scaled_dao_fee_numerator = Decimal::from_scaled(scaled_dao_fee_numerator);
        let scaled_dao_fee_denominator = Decimal::from_scaled(scaled_dao_fee_denominator);
        let scaled_dao_fee_floor = Decimal::from_scaled(scaled_dao_fee_floor);

        // {share} = {share} * D18{1} / D18
        let mut scaled_total_fee_shares = scaled_user_shares
            .mul(&scaled_mint_fee)?
            .add(&Decimal::ONE_E18)?
            .sub(&Decimal::ONE)?
            .div(&Decimal::ONE_E18)?;

        let mut scaled_dao_fee_shares = scaled_total_fee_shares
            .mul(&scaled_dao_fee_numerator)?
            .add(&scaled_dao_fee_denominator)?
            .sub(&Decimal::ONE)?
            .div(&scaled_dao_fee_denominator)?;

        // ensure DAO's portion of fees is at least the DAO feeFloor
        let scaled_min_dao_shares = scaled_user_shares
            .mul(&scaled_dao_fee_floor)?
            .add(&Decimal::ONE_E18)?
            .sub(&Decimal::ONE)?
            .div(&Decimal::ONE_E18)?;

        if scaled_dao_fee_shares < scaled_min_dao_shares {
            scaled_dao_fee_shares = scaled_min_dao_shares;
        }

        // 100% to DAO, if necessary
        if scaled_total_fee_shares < scaled_dao_fee_shares {
            scaled_total_fee_shares = scaled_dao_fee_shares.clone();
        }

        // defer fee handouts until distributeFees()
        self.dao_pending_fee_shares = self
            .dao_pending_fee_shares
            .checked_add(scaled_dao_fee_shares.to_scaled(Rounding::Floor)?)
            .ok_or(ErrorCode::MathOverflow)?;

        self.fee_recipients_pending_fee_shares = self
            .fee_recipients_pending_fee_shares
            .checked_add(
                scaled_total_fee_shares
                    .sub(&scaled_dao_fee_shares)?
                    .to_scaled(Rounding::Floor)?,
            )
            .ok_or(ErrorCode::MathOverflow)?;

        scaled_total_fee_shares.to_token_amount(Rounding::Ceiling)
    }

    /// Poke the folio, meaning we update the pending fee shares for both the DAO and the fee recipients.
    ///
    /// # Arguments
    /// * `raw_folio_token_supply` - The total supply of the folio token (D9).
    /// * `current_time` - The current time (seconds).
    /// * `scaled_dao_fee_numerator` - The numerator of the DAO fee (D18).
    /// * `scaled_dao_fee_denominator` - The denominator of the DAO fee (D18).
    /// * `scaled_dao_fee_floor` - The floor of the DAO fee (D18).
    pub fn poke(
        &mut self,
        raw_folio_token_supply: u64,
        current_time: i64,
        scaled_dao_fee_numerator: u128,
        scaled_dao_fee_denominator: u128,
        scaled_dao_fee_floor: u128,
    ) -> Result<()> {
        if current_time.saturating_sub(self.last_poke) == 0 {
            return Ok(());
        }

        let (scaled_fee_recipients_pending_fee, scaled_dao_pending_fee_shares) = self
            .get_pending_fee_shares(
                raw_folio_token_supply,
                current_time,
                scaled_dao_fee_numerator,
                scaled_dao_fee_denominator,
                scaled_dao_fee_floor,
            )?;

        self.dao_pending_fee_shares = self
            .dao_pending_fee_shares
            .checked_add(scaled_dao_pending_fee_shares.to_scaled(Rounding::Floor)?)
            .ok_or(ErrorCode::MathOverflow)?;

        self.fee_recipients_pending_fee_shares = self
            .fee_recipients_pending_fee_shares
            .checked_add(scaled_fee_recipients_pending_fee.to_scaled(Rounding::Floor)?)
            .ok_or(ErrorCode::MathOverflow)?;

        self.last_poke = current_time;

        Ok(())
    }

    /// Get the total supply of the folio, including the pending fee shares, as they're technically part of the supply.
    ///
    /// # Arguments
    /// * `raw_folio_token_supply` - The total supply of the folio token (D9).
    ///
    /// # Returns
    /// * `Decimal` - The total supply of the folio, including the pending fees (D18).
    pub fn get_total_supply(&self, raw_folio_token_supply: u64) -> Result<Decimal> {
        let scaled_total_supply = Decimal::from_token_amount(raw_folio_token_supply)?;

        scaled_total_supply
            .add(&Decimal::from_scaled(self.dao_pending_fee_shares))?
            .add(&Decimal::from_scaled(
                self.fee_recipients_pending_fee_shares,
            ))
    }

    /// Get the pending fee shares for both the DAO and the fee recipients.
    ///
    /// # Arguments
    /// * `raw_folio_token_supply` - The total supply of the folio token (D9).
    /// * `current_time` - The current time (seconds).
    /// * `scaled_dao_fee_numerator` - The numerator of the DAO fee (D18).
    /// * `scaled_dao_fee_denominator` - The denominator of the DAO fee (D18).
    /// * `scaled_dao_fee_floor` - The floor of the DAO fee (D18).
    pub fn get_pending_fee_shares(
        &self,
        raw_folio_token_supply: u64,
        current_time: i64,
        scaled_dao_fee_numerator: u128,
        scaled_dao_fee_denominator: u128,
        scaled_dao_fee_floor: u128,
    ) -> Result<(Decimal, Decimal)> {
        let scaled_total_supply_with_pending_fees =
            self.get_total_supply(raw_folio_token_supply)?;

        let elapsed = (current_time - self.last_poke) as u64;

        // convert annual percentage to per-second for comparison with stored tvlFee
        // = 1 - (1 - feeFloor) ^ (1 / 31536000)
        // D18{1/s} = D18{1} - D18{1} * D18{1} ^ D18{1/s}
        let scaled_one_minus_fee_floor =
            Decimal::ONE_E18.sub(&Decimal::from_scaled(scaled_dao_fee_floor))?;

        let scaled_fee_floor =
            Decimal::ONE_E18.sub(&scaled_one_minus_fee_floor.nth_root(YEAR_IN_SECONDS)?)?;

        // Use higher of fee floor or TVL fee  D18{1/s}
        let scaled_tvl_fee = Decimal::from_scaled(self.tvl_fee);
        let scaled_tvl_fee_to_use = if scaled_fee_floor > scaled_tvl_fee {
            scaled_fee_floor.clone()
        } else {
            scaled_tvl_fee
        };

        // Calculate fee shares {share} += {share} * D18 / D18{1/s} ^ {s} - {share}
        let scaled_one_minus_tvl_fee = Decimal::ONE_E18.sub(&scaled_tvl_fee_to_use)?;
        let scaled_denominator = scaled_one_minus_tvl_fee.pow(elapsed)?;
        let scaled_fee_shares = scaled_total_supply_with_pending_fees
            .mul(&Decimal::ONE_E18)?
            .div(&scaled_denominator)?
            .sub(&scaled_total_supply_with_pending_fees)?;

        // Calculate correction D18{1} = D18{1/s} * D18 / D18{1/s}
        let scaled_correction = scaled_fee_floor
            .mul(&Decimal::ONE_E18)?
            .add(&scaled_tvl_fee_to_use)?
            .sub(&Decimal::ONE)?
            .div(&scaled_tvl_fee_to_use)?;

        // Calculate DAO ratio
        let scaled_dao_ratio = Decimal::from_scaled(scaled_dao_fee_numerator)
            .mul(&Decimal::ONE_E18)?
            .add(&Decimal::from_scaled(scaled_dao_fee_denominator))?
            .sub(&Decimal::ONE)?
            .div(&Decimal::from_scaled(scaled_dao_fee_denominator))?;

        // Calculate DAO shares {share} = {share} * D18{1} / D18
        let scaled_dao_shares = if scaled_correction > scaled_dao_ratio {
            scaled_fee_shares
                .mul(&scaled_correction)?
                .add(&Decimal::ONE_E18)?
                .sub(&Decimal::ONE)?
                .div(&Decimal::ONE_E18)?
        } else {
            scaled_fee_shares
                .mul(&Decimal::from_scaled(scaled_dao_fee_numerator))?
                .add(&Decimal::from_scaled(scaled_dao_fee_denominator))?
                .sub(&Decimal::ONE)?
                .div(&Decimal::from_scaled(scaled_dao_fee_denominator))?
        };

        // Calculate fee recipient shares {share} = {share} - {share}
        let scaled_fee_recipient_shares = scaled_fee_shares.sub(&scaled_dao_shares)?;

        Ok((scaled_fee_recipient_shares, scaled_dao_shares))
    }

    /// Get the auction end for the mints. The auction ends are the timestamp {s} of the latest ongoing auction (sell or buy).
    ///
    /// # Arguments
    /// * `sell_mint` - The mint of the sell auction.
    /// * `buy_mint` - The mint of the buy auction.
    ///
    /// # Returns
    /// * `Option<&AuctionEnd>` - The auction end for the sell auction if it exists.
    /// * `Option<&AuctionEnd>` - The auction end for the buy auction if it exists.
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

    /// Set the auction end for the mints.
    ///
    /// # Arguments
    /// * `sell_mint` - The mint of the sell auction.
    /// * `buy_mint` - The mint of the buy auction.
    /// * `end_time_sell` - The end time of the sell auction {s}.
    /// * `end_time_buy` - The end time of the buy auction {s}.
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
