use anchor_lang::prelude::*;

use crate::state::FolioTokenMetadata;

impl FolioTokenMetadata {
    pub fn process_init_if_needed(
        &mut self,
        bump: u8,
        folio_key: &Pubkey,
        token_mint: &Pubkey,
    ) -> Result<()> {
        if self.mint == Pubkey::default() {
            self.bump = bump;
            self.mint = *token_mint;
            self.folio = *folio_key;
            self.scaled_dust_amount = 0;
        }

        Ok(())
    }
}
