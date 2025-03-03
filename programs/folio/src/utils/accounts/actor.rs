use anchor_lang::prelude::*;
use shared::check_condition;

use crate::state::Actor;
use shared::errors::ErrorCode;

impl Actor {
    /// Process the init if needed, meaning we initialize the account if it's not initialized yet and if it already is
    /// we check if the bump is correct.
    ///
    /// # Arguments
    /// * `account_bump` - The bump of the account.
    /// * `context_bump` - The bump of the account provided in the anchor context.
    /// * `authority` - The authority of the actor.
    /// * `folio` - The folio the actor belongs to.
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

    /// Reset the actor.
    /// This will set the roles to 0, and the authority and folio to the default pubkey.
    pub fn reset(&mut self) {
        self.roles = 0;
        self.authority = Pubkey::default();
        self.folio = Pubkey::default();
    }
}
