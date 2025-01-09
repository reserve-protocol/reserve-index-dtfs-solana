use crate::{
    program::Folio as FolioProgram,
    state::{Actor, Folio, ProgramRegistrar},
    DtfProgram,
};
use anchor_lang::prelude::*;
use shared::{
    check_condition,
    constants::{FOLIO_SEEDS, MIN_DAO_MINTING_FEE},
    errors::ErrorCode,
    structs::{DecimalValue, FolioStatus, Role},
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
        user_shares: DecimalValue,
        dao_fee_config: &AccountInfo,
    ) -> Result<DecimalValue> {
        let (dao_fee_numerator, dao_fee_denominator, _) =
            DtfProgram::get_dao_fee_config(dao_fee_config)?;

        let minting_fee = self
            .minting_fee
            .add_sub(&DecimalValue::SCALAR, &DecimalValue::ONE)
            .unwrap();

        let mut total_fee_shares = user_shares
            .mul_div(&minting_fee, &DecimalValue::SCALAR)
            .unwrap();

        let mut dao_fee_shares = total_fee_shares
            .mul_div(
                &dao_fee_numerator
                    .add_sub(&dao_fee_denominator, &DecimalValue::ONE)
                    .unwrap(),
                &dao_fee_denominator,
            )
            .unwrap();

        let min_dao_shares = user_shares
            .mul_div(
                &MIN_DAO_MINTING_FEE
                    .add_sub(&DecimalValue::SCALAR, &DecimalValue::ONE)
                    .unwrap(),
                &DecimalValue::SCALAR,
            )
            .unwrap();

        if dao_fee_shares < min_dao_shares {
            dao_fee_shares = min_dao_shares;
        }

        if total_fee_shares < dao_fee_shares {
            total_fee_shares = dao_fee_shares;
        }

        self.dao_pending_fee_shares = self.dao_pending_fee_shares.add(&dao_fee_shares).unwrap();
        self.fee_recipients_pending_fee_shares = self
            .fee_recipients_pending_fee_shares
            .add(&total_fee_shares.sub(&dao_fee_shares).unwrap())
            .unwrap();

        Ok(total_fee_shares)
    }

    pub fn poke(&mut self, folio_token_supply: u64, dao_fee_config: &AccountInfo) -> Result<()> {
        let current_time = Clock::get()?.unix_timestamp;

        // Already updated
        if current_time - self.last_poke == 0 {
            return Ok(());
        }

        let (dao_pending_fee_shares, fee_recipients_pending_fee) =
            self.get_pending_fee_shares(folio_token_supply, current_time, dao_fee_config)?;

        self.dao_pending_fee_shares = self
            .dao_pending_fee_shares
            .add(&dao_pending_fee_shares)
            .unwrap();
        self.fee_recipients_pending_fee_shares = self
            .fee_recipients_pending_fee_shares
            .add(&fee_recipients_pending_fee)
            .unwrap();

        self.last_poke = current_time;

        Ok(())
    }

    pub fn get_total_supply(&self, folio_token_supply: u64) -> DecimalValue {
        DecimalValue::from_u64(folio_token_supply)
            .add(&self.dao_pending_fee_shares)
            .unwrap()
            .add(&self.fee_recipients_pending_fee_shares)
            .unwrap()
    }

    fn get_pending_fee_shares(
        &self,
        folio_token_supply: u64,
        current_time: i64,
        dao_fee_config: &AccountInfo,
    ) -> Result<(DecimalValue, DecimalValue)> {
        let (dao_fee_numerator, dao_fee_denominator, _) =
            DtfProgram::get_dao_fee_config(dao_fee_config)?;

        let total_supply = self.get_total_supply(folio_token_supply);

        let elapsed = current_time - self.last_poke;

        let denominator = DecimalValue::SCALAR
            .sub(&self.folio_fee)
            .unwrap()
            .pow(elapsed as u128)
            .unwrap();

        let fee_shares = total_supply
            .mul_div(&DecimalValue::SCALAR, &denominator)
            .unwrap()
            .sub(&total_supply)
            .unwrap();

        // TODO : dao fee shares?

        let dao_shares = DecimalValue::ONE
            .mul_div(
                &fee_shares
                    .mul(&dao_fee_numerator)
                    .unwrap()
                    .add_sub(&dao_fee_denominator, &DecimalValue::ONE)
                    .unwrap(),
                &dao_fee_denominator,
            )
            .unwrap();

        Ok((fee_shares.sub(&dao_shares).unwrap(), dao_shares))
    }
}
