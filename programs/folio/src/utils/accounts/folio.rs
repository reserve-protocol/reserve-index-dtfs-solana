use crate::{
    state::{Folio, ProgramRegistrar},
    DtfProgram,
};
use anchor_lang::prelude::*;
use shared::{
    check_condition,
    constants::{ACTOR_SEEDS, MAX_FEE_RECIPIENTS, PRECISION_FACTOR},
    errors::ErrorCode,
    structs::{FeeRecipient, Role},
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

        check_condition!(actor.data_len() >= 74, InvalidAccountData);

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

    pub fn update_fee_recipients(
        &mut self,
        fee_recipients_to_add: Vec<FeeRecipient>,
        fee_recipients_to_remove: Vec<Pubkey>,
    ) -> Result<()> {
        let mut new_recipients = [FeeRecipient::default(); MAX_FEE_RECIPIENTS];
        let mut add_index = 0;

        for fee_recipient in self.fee_recipients.iter() {
            if !fee_recipients_to_remove.contains(&fee_recipient.receiver)
                && fee_recipient.receiver != Pubkey::default()
            {
                new_recipients[add_index] = *fee_recipient;
                add_index += 1;
            }
        }

        for new_recipient in fee_recipients_to_add {
            check_condition!(add_index < MAX_FEE_RECIPIENTS, InvalidFeeRecipientCount);
            new_recipients[add_index] = new_recipient;
            add_index += 1;
        }

        self.fee_recipients = new_recipients;

        self.validate_fee_recipient_total_shares()
    }

    pub fn validate_fee_recipient_total_shares(&self) -> Result<()> {
        check_condition!(
            self.fee_recipients.iter().map(|r| r.share).sum::<u64>() == PRECISION_FACTOR,
            InvalidFeeRecipientShares
        );

        Ok(())
    }
}
