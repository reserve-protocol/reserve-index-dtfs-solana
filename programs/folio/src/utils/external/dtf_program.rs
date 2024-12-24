use anchor_lang::{
    prelude::*,
    solana_program::{self, bpf_loader_upgradeable, hash},
};

use shared::{check_condition, errors::ErrorCode};

pub struct DtfProgram;

/*
Because the 2 programs call each other, we can't have a circular dependency. Therefore I've decided that the dtf program will
include the folio program as a dependency, so we need to do it manually for the folio to the dtf program.
*/

impl DtfProgram {
    const DISCRIMINATOR_SIZE: usize = 8;
    const INIT_FIRST_OWNER: &'static str = "init_first_owner";

    pub fn get_program_deployment_slot(
        program_id: &Pubkey,
        program_info: &AccountInfo,
        program_data_account: &AccountInfo,
    ) -> Result<u64> {
        check_condition!(program_info.executable, InvalidProgram);

        let (program_data_address, _) =
            Pubkey::find_program_address(&[program_id.as_ref()], &bpf_loader_upgradeable::id());

        let data = program_info.try_borrow_data()?;

        if let UpgradeableLoaderState::Program {
            programdata_address,
        } = UpgradeableLoaderState::try_deserialize(&mut &**data)?
        {
            check_condition!(programdata_address == program_data_address, InvalidProgram);

            let program_data = program_data_account.try_borrow_data()?;

            if let UpgradeableLoaderState::ProgramData { slot, .. } =
                UpgradeableLoaderState::try_deserialize(&mut &**program_data)?
            {
                return Ok(slot);
            }
        }

        Err(error!(ErrorCode::InvalidProgram))
    }

    fn get_instruction_discriminator(name: &str) -> [u8; 8] {
        let preimage = format!("global:{}", name);

        let mut sighash = [0u8; 8];

        sighash.copy_from_slice(&hash::hash(preimage.as_bytes()).to_bytes()[..8]);

        sighash
    }

    #[allow(clippy::too_many_arguments)]
    pub fn init_first_owner<'info>(
        system_program: AccountInfo<'info>,
        rent: AccountInfo<'info>,
        folio_owner: AccountInfo<'info>,
        folio_program_signer: AccountInfo<'info>,
        actor: AccountInfo<'info>,
        folio: AccountInfo<'info>,
        dtf_program: AccountInfo<'info>,
        signer_seeds: &[&[u8]],
    ) -> Result<()> {
        let discriminator = Self::get_instruction_discriminator(Self::INIT_FIRST_OWNER);

        let mut data = Vec::with_capacity(Self::DISCRIMINATOR_SIZE);
        data.extend_from_slice(&discriminator);

        let ix = solana_program::instruction::Instruction {
            program_id: dtf_program.key(),
            accounts: vec![
                AccountMeta::new_readonly(system_program.key(), false),
                AccountMeta::new_readonly(rent.key(), false),
                AccountMeta::new(folio_owner.key(), true),
                AccountMeta::new_readonly(folio_program_signer.key(), true),
                AccountMeta::new(actor.key(), false),
                AccountMeta::new_readonly(folio.key(), false),
            ],
            data,
        };

        solana_program::program::invoke_signed(
            &ix,
            &[
                system_program.to_account_info(),
                rent.to_account_info(),
                folio_owner.to_account_info(),
                folio_program_signer.to_account_info(),
                actor.to_account_info(),
                folio.to_account_info(),
            ],
            &[signer_seeds],
        )?;

        Ok(())
    }
}
