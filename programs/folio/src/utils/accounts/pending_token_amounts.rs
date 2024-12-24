use anchor_lang::prelude::*;
use anchor_lang::solana_program::system_program;
use shared::check_condition;
use shared::constants::MAX_TOKEN_AMOUNTS;
use shared::errors::ErrorCode;
use shared::errors::ErrorCode::InvalidAddedTokenMints;
use shared::structs::TokenAmount;

use crate::state::PendingTokenAmounts;

impl PendingTokenAmounts {
    pub fn process_init_if_needed(
        account_loader_pending_token_amounts: &mut AccountLoader<PendingTokenAmounts>,
        context_bump: u8,
        folio: &Pubkey,
        added_mints: Vec<Pubkey>,
    ) -> Result<()> {
        let account_info_pending_token_amounts =
            account_loader_pending_token_amounts.to_account_info();

        let data = account_info_pending_token_amounts.try_borrow_mut_data()?;
        let mut disc_bytes = [0u8; 8];
        disc_bytes.copy_from_slice(&data[..8]);

        let discriminator = u64::from_le_bytes(disc_bytes);

        drop(data);

        if discriminator == 0 {
            // Not initialized yet
            let pending_token_amounts = &mut account_loader_pending_token_amounts.load_init()?;

            pending_token_amounts.bump = context_bump;
            pending_token_amounts.owner = *folio;
            pending_token_amounts.token_amounts = [TokenAmount::default(); MAX_TOKEN_AMOUNTS];

            pending_token_amounts.add_token_amounts_to_folio(added_mints)?;
        } else {
            let pending_token_amounts = &mut account_loader_pending_token_amounts.load_mut()?;
            check_condition!(pending_token_amounts.bump == context_bump, InvalidBump);

            pending_token_amounts.add_token_amounts_to_folio(added_mints)?;
        }

        Ok(())
    }

    /*
    Only used if the owner is a folio
     */
    pub fn add_token_amounts_to_folio(&mut self, token_mints: Vec<Pubkey>) -> Result<()> {
        let mut existing_mints = [Pubkey::default(); MAX_TOKEN_AMOUNTS];
        let mut existing_count = 0;

        for token in self.token_amounts.iter() {
            if token.mint != Pubkey::default() {
                existing_mints[existing_count] = token.mint;
                existing_count += 1;
            }
        }

        for mint in token_mints {
            if existing_mints[..existing_count].contains(&mint) {
                continue;
            }

            if let Some(slot) = self
                .token_amounts
                .iter_mut()
                .find(|ta| ta.mint == Pubkey::default())
            {
                slot.mint = mint;
                slot.amount = 0;

                if existing_count < MAX_TOKEN_AMOUNTS {
                    existing_mints[existing_count] = mint;
                    existing_count += 1;
                }
            } else {
                // No available slot found, return an error
                return Err(error!(InvalidAddedTokenMints));
            }
        }

        Ok(())
    }
}
