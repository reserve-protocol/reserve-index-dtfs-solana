use crate::{
    program::Folio as FolioProgram,
    state::{Actor, Folio, ProgramRegistrar},
    DtfProgram,
};
use anchor_lang::prelude::*;
use shared::{
    check_condition,
    constants::FOLIO_SEEDS,
    errors::ErrorCode,
    structs::{FolioStatus, Role},
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
}
