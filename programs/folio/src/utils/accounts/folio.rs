use crate::{
    state::{Folio, ProgramRegistrar},
    DtfProgram,
};
use anchor_lang::prelude::*;
use shared::{check_condition, constants::ACTOR_SEEDS, errors::ErrorCode, structs::Role};

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

    pub fn validate_folio_program_post_init<'info>(
        self,
        program_registrar: &Account<'info, ProgramRegistrar>,
        dtf_program: &AccountInfo<'info>,
        dtf_program_data: &AccountInfo<'info>,
        expected_bump: Option<u8>,
        actor: Option<&AccountInfo<'info>>,
        required_role: Role,
    ) -> Result<()> {
        /*
        Validate program is in registrar and has same deployment slot
         */
        self.validate_program_registrar(program_registrar, dtf_program, dtf_program_data)?;

        // Validate folio bump
        if let Some(expected_bump) = expected_bump {
            check_condition!(self.bump == expected_bump, InvalidBump);
        }

        // Validate Role if needed
        if let Some(actor) = actor {
            Folio::validate_permission_for_action(actor, required_role, dtf_program)?;
        }

        Ok(())
    }

    fn validate_program_registrar<'info>(
        self,
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

    fn validate_permission_for_action<'info>(
        actor: &AccountInfo,
        required_role: Role,
        dtf_program: &AccountInfo<'info>,
    ) -> Result<()> {
        /*
        Manually deserialize the actor data
         */
        let data = &actor.data.borrow();

        check_condition!(actor.data_len() >= 8 + 74, InvalidAccountData);

        // Discriminator takes 8 bytes and bump 1
        let authority = Pubkey::try_from_slice(&data[9..41])?;
        let folio = Pubkey::try_from_slice(&data[41..73])?;
        let roles = data[73];

        // Don't need the rest of the data

        check_condition!(Role::has_role(roles, required_role), InvalidRole);

        /*
        Validate actor PDA
         */
        let (expected_actor_pda, _) = Pubkey::find_program_address(
            &[ACTOR_SEEDS, authority.as_ref(), folio.as_ref()],
            &dtf_program.key(),
        );

        check_condition!(actor.key() == expected_actor_pda, InvalidActorPda);

        Ok(())
    }
}
