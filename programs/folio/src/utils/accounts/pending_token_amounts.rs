use anchor_lang::prelude::*;
use anchor_lang::solana_program::system_program;
use shared::check_condition;
use shared::constants::MAX_TOKEN_AMOUNTS;
use shared::errors::ErrorCode;
use shared::errors::ErrorCode::InvalidAddedTokenMints;
use shared::errors::ErrorCode::*;
use shared::structs::TokenAmount;

use crate::state::PendingTokenAmounts;

impl PendingTokenAmounts {
    pub fn process_init_if_needed(
        account_loader_pending_token_amounts: &mut AccountLoader<PendingTokenAmounts>,
        context_bump: u8,
        folio: &Pubkey,
        added_token_amounts: &Vec<TokenAmount>,
        can_add_new_mints: bool,
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

            pending_token_amounts
                .add_token_amounts_to_folio(added_token_amounts, can_add_new_mints)?;
        } else {
            let pending_token_amounts = &mut account_loader_pending_token_amounts.load_mut()?;
            check_condition!(pending_token_amounts.bump == context_bump, InvalidBump);

            pending_token_amounts
                .add_token_amounts_to_folio(added_token_amounts, can_add_new_mints)?;
        }

        Ok(())
    }

    pub fn add_token_amounts_to_folio(
        &mut self,
        token_amounts: &Vec<TokenAmount>,
        can_add_new_mints: bool,
    ) -> Result<()> {
        for token_amount in token_amounts {
            if let Some(slot_for_update) = self
                .token_amounts
                .iter_mut()
                .find(|ta| ta.mint == token_amount.mint)
            {
                slot_for_update.amount = token_amount
                    .amount
                    .checked_add(slot_for_update.amount)
                    .unwrap();
            } else if can_add_new_mints {
                if let Some(slot) = self
                    .token_amounts
                    .iter_mut()
                    .find(|ta| ta.mint == Pubkey::default())
                {
                    slot.mint = token_amount.mint;
                    slot.amount = token_amount.amount;
                } else {
                    // No available slot found, return an error
                    return Err(error!(InvalidAddedTokenMints));
                }
            } else {
                return Err(error!(InvalidAddedTokenMints));
            }
        }

        Ok(())
    }

    pub fn remove_token_amounts_to_folio(
        &mut self,
        token_amounts: &Vec<TokenAmount>,
        needs_to_validate_mint_existence: bool,
    ) -> Result<()> {
        for token_amount in token_amounts {
            if let Some(slot_for_update) = self
                .token_amounts
                .iter_mut()
                .find(|ta| ta.mint == token_amount.mint)
            {
                // Will crash if trying to remove more than actual balance
                slot_for_update.amount = slot_for_update
                    .amount
                    .checked_sub(token_amount.amount)
                    .ok_or(InvalidShareAmountProvided)?;
            } else {
                if needs_to_validate_mint_existence {
                    return Err(error!(InvalidAddedTokenMints));
                }

                continue;
            }
        }

        Ok(())
    }

    pub fn reorder_token_amounts(&mut self, ordering_vec: &[TokenAmount]) -> Result<()> {
        self.token_amounts.sort_by_key(|ta| {
            ordering_vec
                .iter()
                .position(|order_mint| order_mint.mint == ta.mint)
                .unwrap_or(usize::MAX)
        });

        Ok(())
    }
}
