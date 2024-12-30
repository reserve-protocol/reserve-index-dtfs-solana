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
}
