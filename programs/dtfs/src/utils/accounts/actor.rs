use anchor_lang::prelude::*;
use shared::check_condition;

use crate::state::Actor;
use shared::errors::ErrorCode;

impl Actor {
    pub fn process_init_if_needed(
        &mut self,
        account_bump: u8,
        context_bump: u8,
        authority: &Pubkey,
        folio: &Pubkey,
    ) -> Result<()> {
        if account_bump != 0 {
            check_condition!(account_bump == context_bump, InvalidBump);
            return Ok(());
        }

        self.bump = context_bump;
        self.authority = *authority;
        self.folio = *folio;
        self.roles = 0;

        Ok(())
    }

    pub fn reset(&mut self) {
        self.roles = 0;
        self.authority = Pubkey::default();
        self.folio = Pubkey::default();
    }
}
