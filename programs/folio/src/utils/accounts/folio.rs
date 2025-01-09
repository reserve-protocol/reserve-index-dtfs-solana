use crate::{
    program::Folio as FolioProgram,
    state::{Actor, Folio, ProgramRegistrar},
    DtfProgram,
};
use anchor_lang::prelude::*;
use shared::{
    check_condition,
    constants::{FOLIO_SEEDS, MIN_DAO_MINTING_FEE, SCALAR, SCALAR_U128},
    errors::ErrorCode,
    structs::{FolioStatus, Role},
    util::math_util::{RoundingMode, SafeArithmetic},
};

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
        expected_status: Option<FolioStatus>,
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
        if let Some(expected_status) = expected_status {
            check_condition!(self.status == expected_status as u8, FolioNotInitialized);
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

    /// Returns the total number of shares to remove from the mint, and updates the ones on the folio
    pub fn calculate_fees_for_minting(
        &mut self,
        user_shares: u64,
        dao_fee_numerator: u64,
        dao_fee_denominator: u64,
    ) -> Result<u64> {
        let mut total_fee_shares = user_shares
            .mul_precision_to_u128(self.minting_fee)
            .checked_add(SCALAR_U128)
            .unwrap()
            .checked_sub(1)
            .unwrap()
            .checked_div(SCALAR_U128)
            .unwrap();

        println!("total_fee_shares: {}", total_fee_shares);

        let mut dao_fee_shares = total_fee_shares
            .checked_mul(dao_fee_numerator as u128)
            .unwrap()
            .checked_add(dao_fee_denominator as u128)
            .unwrap()
            .checked_sub(1)
            .unwrap()
            .checked_div(dao_fee_denominator as u128)
            .unwrap();

        println!("total_fee_shares: {}", total_fee_shares);
        println!("dao_fee_shares: {}", dao_fee_shares);

        let min_dao_shares =
            SafeArithmetic::mul_precision_to_u128(user_shares, MIN_DAO_MINTING_FEE)
                .checked_add(SCALAR_U128)
                .unwrap()
                .checked_sub(1)
                .unwrap()
                .checked_div(SCALAR_U128)
                .unwrap();

        println!("min_dao_shares: {}", min_dao_shares);

        if dao_fee_shares < min_dao_shares {
            dao_fee_shares = min_dao_shares;
        }

        if total_fee_shares < dao_fee_shares {
            total_fee_shares = dao_fee_shares;
        }

        let total_fee_shares = total_fee_shares as u64;

        self.dao_pending_fee_shares = self
            .dao_pending_fee_shares
            .checked_add(dao_fee_shares as u64)
            .unwrap();
        self.fee_recipients_pending_fee_shares = self
            .fee_recipients_pending_fee_shares
            .checked_add(total_fee_shares.checked_sub(dao_fee_shares as u64).unwrap())
            .unwrap();

        Ok(total_fee_shares)
    }

    pub fn poke(
        &mut self,
        folio_token_supply: u64,
        current_time: i64,
        dao_fee_numerator: u64,
        dao_fee_denominator: u64,
    ) -> Result<()> {
        if current_time - self.last_poke == 0 {
            return Ok(());
        }

        let (dao_pending_fee_shares, fee_recipients_pending_fee) = self.get_pending_fee_shares(
            folio_token_supply,
            current_time,
            dao_fee_numerator,
            dao_fee_denominator,
        )?;

        self.dao_pending_fee_shares = self
            .dao_pending_fee_shares
            .checked_add(dao_pending_fee_shares)
            .unwrap();
        self.fee_recipients_pending_fee_shares = self
            .fee_recipients_pending_fee_shares
            .checked_add(fee_recipients_pending_fee)
            .unwrap();

        self.last_poke = current_time;

        Ok(())
    }

    pub fn get_total_supply(&self, folio_token_supply: u64) -> u64 {
        folio_token_supply
            .checked_add(self.dao_pending_fee_shares)
            .unwrap()
            .checked_add(self.fee_recipients_pending_fee_shares)
            .unwrap()
    }

    pub fn get_pending_fee_shares(
        &self,
        folio_token_supply: u64,
        current_time: i64,
        dao_fee_numerator: u64,
        dao_fee_denominator: u64,
    ) -> Result<(u64, u64)> {
        let total_supply = self.get_total_supply(folio_token_supply);
        let elapsed = current_time - self.last_poke;

        println!("SCALAR: {}", SCALAR);
        println!("self.folio_fee: {}", self.folio_fee);
        println!("elapsed: {}", elapsed);
        println!("total_supply: {}", total_supply);

        // Calculate compound factor using our new method
        let compound_factor = <u64 as SafeArithmetic>::compound_interest(
            self.folio_fee,
            elapsed as u64,
            RoundingMode::Floor,
        );
        println!("compound_factor: {}", compound_factor);

        // Calculate fee shares
        // Instead of division by denominator and subtraction, multiply by (1 - compound_factor)
        let fee_shares = total_supply.mul_div_precision(
            SCALAR - compound_factor, // This gives us the fee portion
            SCALAR,
            RoundingMode::Floor,
        );

        println!("fee_shares: {}", fee_shares);

        // Calculate DAO's portion of the fees
        let dao_shares = fee_shares.mul_div_precision(
            dao_fee_numerator,
            dao_fee_denominator,
            RoundingMode::Floor,
        );

        println!("dao_shares: {}", dao_shares);

        Ok((fee_shares.checked_sub(dao_shares).unwrap(), dao_shares))
    }
}
