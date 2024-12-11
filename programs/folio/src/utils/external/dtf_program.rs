use anchor_lang::{
    prelude::*,
    solana_program::{self, keccak},
};

pub struct DtfProgram;

/*
Because the 2 programs call each other, we can't have a circular dependency. Therefore I've decided that the dtf program will
include the folio program as a dependency, so we need to do it manually for the folio to the dtf program.
*/

impl DtfProgram {
    const DISCRIMINATOR_SIZE: usize = 8;
    const INIT_FIRST_OWNER: &'static str = "init_first_owner";

    fn get_instruction_discriminator(name: &str) -> [u8; 8] {
        let preimage = format!("global:{}", name);

        let mut sighash = [0u8; 8];

        sighash.copy_from_slice(&keccak::hash(preimage.as_bytes()).to_bytes()[..8]);

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
                AccountMeta::new(system_program.key(), false),
                AccountMeta::new(rent.key(), false),
                AccountMeta::new(folio_owner.key(), true),
                AccountMeta::new(folio_program_signer.key(), true),
                AccountMeta::new(actor.key(), false),
                AccountMeta::new(folio.key(), false),
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
