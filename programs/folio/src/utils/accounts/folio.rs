use crate::{
    events::FolioFeeSet,
    program::Folio as FolioProgram,
    state::{Actor, Folio, ProgramRegistrar},
    DtfProgram,
};
use anchor_lang::prelude::*;
use shared::errors::ErrorCode::*;
use shared::{
    check_condition,
    constants::{ANNUALIZATION_EXP, D18, FOLIO_SEEDS, MAX_FOLIO_FEE, MIN_DAO_MINTING_FEE},
    errors::ErrorCode,
    structs::{FolioStatus, Role, TradeEnd},
    util::math_util::CustomPreciseNumber,
};
use spl_math::uint::U256;

impl Folio {
    pub fn validate_folio_program_for_init<'info>(
        program_registrar: &Account<'info, ProgramRegistrar>,
        dtf_program: &AccountInfo<'info>,
    ) -> Result<()> {
        check_condition!(
            program_registrar.is_in_registrar(dtf_program.key()),
            ProgramNotInRegistrar
        );

        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn validate_folio_program_post_init<'info>(
        &self,
        folio_pubkey: &Pubkey,
        program_registrar: Option<&Account<'info, ProgramRegistrar>>,
        dtf_program: Option<&AccountInfo<'info>>,
        dtf_program_data: Option<&AccountInfo<'info>>,
        actor: Option<&Account<'info, Actor>>,
        required_role: Option<Role>,
        expected_statuses: Option<Vec<FolioStatus>>,
    ) -> Result<()> {
        /*
        Validate program is in registrar and has same deployment slot
         */
        if let (Some(program_registrar), Some(dtf_program), Some(dtf_program_data)) =
            (program_registrar, dtf_program, dtf_program_data)
        {
            self.validate_program_registrar(program_registrar, dtf_program, dtf_program_data)?;
        }

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
        if let (Some(actor), Some(required_role)) = (actor, required_role) {
            Folio::validate_permission_for_action(actor, required_role)?;
        }

        // Validate folio status is initialized
        if let Some(expected_statuses) = expected_statuses {
            check_condition!(
                expected_statuses.contains(&FolioStatus::from(self.status)),
                FolioNotInitialized
            );
        }

        Ok(())
    }

    fn validate_program_registrar<'info>(
        &self,
        program_registrar: &Account<'info, ProgramRegistrar>,
        dtf_program: &AccountInfo<'info>,
        dtf_program_data: &AccountInfo<'info>,
    ) -> Result<()> {
        check_condition!(
            program_registrar.is_in_registrar(dtf_program.key()),
            ProgramNotInRegistrar
        );

        let deployment_slot = DtfProgram::get_program_deployment_slot(
            &dtf_program.key(),
            &dtf_program.to_account_info(),
            &dtf_program_data.to_account_info(),
        )?;

        check_condition!(
            self.program_deployment_slot == deployment_slot,
            InvalidProgram
        );

        Ok(())
    }

    fn validate_permission_for_action(
        actor: &Account<'_, Actor>,
        required_role: Role,
    ) -> Result<()> {
        check_condition!(Role::has_role(actor.roles, required_role), InvalidRole);

        Ok(())
    }

    pub fn set_folio_fee(&mut self, fee: u128) -> Result<()> {
        check_condition!(fee <= MAX_FOLIO_FEE, InvalidFeePerSecond);

        // convert annual percentage to per-second
        let base = D18.checked_sub(U256::from(fee)).ok_or(MathOverflow)?;

        let power_result = base.checked_pow(ANNUALIZATION_EXP).ok_or(MathOverflow)?;

        let fee_per_second = D18.checked_sub(power_result).ok_or(MathOverflow)?;

        check_condition!(
            fee == 0 || fee_per_second != U256::from(0),
            InvalidFeePerSecond
        );

        self.folio_fee = fee_per_second.try_into().unwrap();

        emit!(FolioFeeSet {
            new_fee: self.folio_fee,
        });

        Ok(())
    }

    /// Returns the total number of shares to remove from the mint, and updates the ones on the folio
    pub fn calculate_fees_for_minting(
        &mut self,
        user_shares: u64,
        dao_fee_numerator: u128,
        dao_fee_denominator: u128,
    ) -> Result<u64> {
        let total_fee_shares = CustomPreciseNumber::from_u64(user_shares)?
            // Minting fee is already scaled by D18
            .mul_generic(U256::from(self.minting_fee))?
            .add_generic(D18)?
            .sub_generic(CustomPreciseNumber::one())?
            .div_generic(D18)?;

        let mut dao_fee_shares = total_fee_shares
            .mul_generic(U256::from(dao_fee_numerator))?
            .add_generic(U256::from(dao_fee_denominator))?
            .sub_generic(CustomPreciseNumber::one())?
            .div_generic(U256::from(dao_fee_denominator))?
            .to_u64_floor()?;

        let min_dao_shares = CustomPreciseNumber::from_u64(user_shares)?
            .mul_generic(U256::from(MIN_DAO_MINTING_FEE))?
            .add_generic(D18)?
            .sub_generic(CustomPreciseNumber::one())?
            .div_generic(D18)?
            .to_u64_floor()?;

        if dao_fee_shares < min_dao_shares {
            dao_fee_shares = min_dao_shares;
        }

        let mut total_fee_shares_scaled = total_fee_shares.to_u64_floor()?;

        if total_fee_shares_scaled < dao_fee_shares {
            total_fee_shares_scaled = dao_fee_shares;
        }

        self.dao_pending_fee_shares = self
            .dao_pending_fee_shares
            .checked_add(dao_fee_shares)
            .ok_or(ErrorCode::MathOverflow)?;

        self.fee_recipients_pending_fee_shares = self
            .fee_recipients_pending_fee_shares
            .checked_add(
                total_fee_shares_scaled
                    .checked_sub(dao_fee_shares)
                    .ok_or(ErrorCode::MathOverflow)?,
            )
            .ok_or(ErrorCode::MathOverflow)?;

        Ok(total_fee_shares_scaled)
    }

    pub fn poke(
        &mut self,
        folio_token_supply: u64,
        current_time: i64,
        dao_fee_numerator: u128,
        dao_fee_denominator: u128,
    ) -> Result<()> {
        if current_time - self.last_poke == 0 {
            return Ok(());
        }

        let (fee_recipients_pending_fee, dao_pending_fee_shares) = self.get_pending_fee_shares(
            folio_token_supply,
            current_time,
            dao_fee_numerator,
            dao_fee_denominator,
        )?;

        self.dao_pending_fee_shares = self
            .dao_pending_fee_shares
            .checked_add(dao_pending_fee_shares)
            .ok_or(ErrorCode::MathOverflow)?;
        self.fee_recipients_pending_fee_shares = self
            .fee_recipients_pending_fee_shares
            .checked_add(fee_recipients_pending_fee)
            .ok_or(ErrorCode::MathOverflow)?;

        self.last_poke = current_time;

        Ok(())
    }

    pub fn get_total_supply(&self, folio_token_supply: u64) -> Result<u64> {
        Ok(folio_token_supply
            .checked_add(self.dao_pending_fee_shares)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_add(self.fee_recipients_pending_fee_shares)
            .ok_or(ErrorCode::MathOverflow)?)
    }

    pub fn get_pending_fee_shares(
        &self,
        folio_token_supply: u64,
        current_time: i64,
        dao_fee_numerator: u128,
        dao_fee_denominator: u128,
    ) -> Result<(u64, u64)> {
        let total_supply = self.get_total_supply(folio_token_supply)?;
        let elapsed = (current_time - self.last_poke) as u64;

        // TODO changed on the Solidity side
        // Calculate annual rate in smaller chunks
        let seconds_per_year = 365 * 24 * 3600;
        let fee_rate = D18
            .checked_sub(U256::from(self.folio_fee))
            .ok_or(error!(ErrorCode::MathOverflow))?;

        // Calculate the compound factor for the elapsed time
        let compound_multiplier = U256::from(elapsed)
            .checked_mul(D18)
            .ok_or(error!(ErrorCode::MathOverflow))?
            .checked_div(U256::from(seconds_per_year))
            .ok_or(error!(ErrorCode::MathOverflow))?;

        let fee_amount = U256::from(total_supply)
            .checked_mul(compound_multiplier)
            .ok_or(error!(ErrorCode::MathOverflow))?
            .checked_mul(fee_rate)
            .ok_or(error!(ErrorCode::MathOverflow))?
            .checked_div(D18)
            .ok_or(error!(ErrorCode::MathOverflow))?
            .checked_div(D18)
            .ok_or(error!(ErrorCode::MathOverflow))?;

        let dao_shares = fee_amount
            .checked_mul(U256::from(dao_fee_numerator))
            .ok_or(error!(ErrorCode::MathOverflow))?
            .checked_div(U256::from(dao_fee_denominator))
            .ok_or(error!(ErrorCode::MathOverflow))?;

        let fee_recipient_shares = fee_amount
            .checked_sub(dao_shares)
            .ok_or(error!(ErrorCode::MathOverflow))?;

        Ok((fee_recipient_shares.as_u64(), dao_shares.as_u64()))
    }

    pub fn get_trade_end_for_mint(
        &self,
        sell_mint: &Pubkey,
        buy_mint: &Pubkey,
    ) -> Result<(Option<&TradeEnd>, Option<&TradeEnd>)> {
        let mut sell_trade = None;
        let mut buy_trade = None;

        for trade_end in self.trade_ends.iter() {
            if trade_end.mint == *sell_mint {
                sell_trade = Some(trade_end);
            } else if trade_end.mint == *buy_mint {
                buy_trade = Some(trade_end);
            }

            if sell_trade.is_some() && buy_trade.is_some() {
                break;
            }
        }

        Ok((sell_trade, buy_trade))
    }

    pub fn set_trade_end_for_mints(
        &mut self,
        sell_mint: &Pubkey,
        buy_mint: &Pubkey,
        end_time: u64,
    ) {
        let mut found_sell_trade = false;
        let mut found_buy_trade = false;

        for trade_end in self.trade_ends.iter_mut() {
            if trade_end.mint == *sell_mint {
                found_sell_trade = true;
                trade_end.end_time = end_time;
            } else if trade_end.mint == *buy_mint {
                found_buy_trade = true;
                trade_end.end_time = end_time;
            }

            if found_sell_trade && found_buy_trade {
                break;
            }
        }
    }
}
