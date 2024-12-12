use crate::error::ErrorCode;
use crate::{check_condition, state::Folio};
use anchor_lang::prelude::*;

impl Folio {
    pub fn validate_folio(self, account_key: Pubkey) -> Result<()> {
        let (expected_pda, expected_bump) = Pubkey::find_program_address(
            &[Folio::SEEDS, self.folio_token_mint.as_ref()],
            &crate::program::Folio::id(),
        );

        check_condition!(self.bump == expected_bump, InvalidBump);
        check_condition!(account_key == expected_pda, InvalidPda);

        Ok(())
    }
}
