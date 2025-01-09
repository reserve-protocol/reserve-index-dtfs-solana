use anchor_lang::{prelude::*, solana_program::bpf_loader_upgradeable};

use shared::{
    check_condition, constants::DAO_FEE_DENOMINATOR, errors::ErrorCode, structs::DecimalValue,
};

pub struct DtfProgram;

/*
Because the 2 programs call each other, we can't have a circular dependency. Therefore I've decided that the dtf program will
include the folio program as a dependency, so we need to do it manually for the folio to the dtf program.
*/

type DtfFeeConfig = (DecimalValue, DecimalValue, Pubkey);

impl DtfProgram {
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

    pub fn get_dao_fee_config(dao_fee_config: &AccountInfo) -> Result<DtfFeeConfig> {
        let data = dao_fee_config.try_borrow_data()?;

        check_condition!(dao_fee_config.data_len() >= 57, InvalidAccountData);

        // Discriminator takes 8 bytes and bump 1
        let fee_recipient = Pubkey::try_from_slice(&data[9..41])?;
        let fee_recipient_numerator = DecimalValue::try_from_slice(&data[41..57])?;

        Ok((fee_recipient_numerator, DAO_FEE_DENOMINATOR, fee_recipient))
    }
}
