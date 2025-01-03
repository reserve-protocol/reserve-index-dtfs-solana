use anchor_lang::prelude::*;
use shared::check_condition;
use shared::constants::{PendingBasketType, MAX_TOKEN_AMOUNTS};
use shared::errors::ErrorCode;
use shared::errors::ErrorCode::InvalidAddedTokenMints;
use shared::errors::ErrorCode::*;
use shared::structs::TokenAmount;

use crate::state::PendingBasket;

impl PendingBasket {
    pub fn process_init_if_needed(
        account_loader_pending_basket: &mut AccountLoader<PendingBasket>,
        context_bump: u8,
        owner: &Pubkey,
        folio: &Pubkey,
        added_token_amounts: &Vec<TokenAmount>,
        can_add_new_mints: bool,
    ) -> Result<()> {
        let account_info_pending_basket = account_loader_pending_basket.to_account_info();

        let data = account_info_pending_basket.try_borrow_mut_data()?;
        let mut disc_bytes = [0u8; 8];
        disc_bytes.copy_from_slice(&data[..8]);

        let discriminator = u64::from_le_bytes(disc_bytes);

        drop(data);

        if discriminator == 0 {
            // Not initialized yet
            let pending_basket = &mut account_loader_pending_basket.load_init()?;

            pending_basket.bump = context_bump;
            pending_basket.owner = *owner;
            pending_basket.folio = *folio;
            pending_basket.token_amounts = [TokenAmount::default(); MAX_TOKEN_AMOUNTS];

            pending_basket.add_token_amounts_to_folio(
                added_token_amounts,
                can_add_new_mints,
                PendingBasketType::MintProcess,
            )?;
        } else {
            let pending_basket = &mut account_loader_pending_basket.load_mut()?;

            check_condition!(pending_basket.bump == context_bump, InvalidBump);

            pending_basket.add_token_amounts_to_folio(
                added_token_amounts,
                can_add_new_mints,
                PendingBasketType::MintProcess,
            )?;
        }

        Ok(())
    }

    pub fn add_token_amounts_to_folio(
        &mut self,
        token_amounts: &Vec<TokenAmount>,
        can_add_new_mints: bool,
        pending_basket_type: PendingBasketType,
    ) -> Result<()> {
        match pending_basket_type {
            PendingBasketType::MintProcess => {
                for token_amount in token_amounts {
                    if let Some(slot_for_update) = self
                        .token_amounts
                        .iter_mut()
                        .find(|ta| ta.mint == token_amount.mint)
                    {
                        slot_for_update.amount_for_minting = token_amount
                            .amount_for_minting
                            .checked_add(slot_for_update.amount_for_minting)
                            .unwrap();
                    } else if can_add_new_mints {
                        if let Some(slot) = self
                            .token_amounts
                            .iter_mut()
                            .find(|ta| ta.mint == Pubkey::default())
                        {
                            slot.mint = token_amount.mint;
                            slot.amount_for_minting = token_amount.amount_for_minting;
                        } else {
                            // No available slot found, return an error
                            return Err(error!(InvalidAddedTokenMints));
                        }
                    } else {
                        return Err(error!(InvalidAddedTokenMints));
                    }
                }
            }
            PendingBasketType::RedeemProcess => {
                for token_amount in token_amounts {
                    if let Some(slot_for_update) = self
                        .token_amounts
                        .iter_mut()
                        .find(|ta| ta.mint == token_amount.mint)
                    {
                        slot_for_update.amount_for_redeeming = token_amount
                            .amount_for_redeeming
                            .checked_add(slot_for_update.amount_for_redeeming)
                            .unwrap();
                    } else if can_add_new_mints {
                        if let Some(slot) = self
                            .token_amounts
                            .iter_mut()
                            .find(|ta| ta.mint == Pubkey::default())
                        {
                            slot.mint = token_amount.mint;
                            slot.amount_for_redeeming = token_amount.amount_for_redeeming;
                        } else {
                            // No available slot found, return an error
                            return Err(error!(InvalidAddedTokenMints));
                        }
                    } else {
                        return Err(error!(InvalidAddedTokenMints));
                    }
                }
            }
        }

        Ok(())
    }

    pub fn remove_token_amounts_from_folio(
        &mut self,
        token_amounts: &Vec<TokenAmount>,
        needs_to_validate_mint_existence: bool,
        pending_basket_type: PendingBasketType,
    ) -> Result<()> {
        match pending_basket_type {
            PendingBasketType::MintProcess => {
                for token_amount in token_amounts {
                    if let Some(slot_for_update) = self
                        .token_amounts
                        .iter_mut()
                        .find(|ta| ta.mint == token_amount.mint)
                    {
                        // Will crash if trying to remove more than actual balance
                        slot_for_update.amount_for_minting = slot_for_update
                            .amount_for_minting
                            .checked_sub(token_amount.amount_for_minting)
                            .ok_or(InvalidShareAmountProvided)?;
                    } else {
                        if needs_to_validate_mint_existence {
                            return Err(error!(InvalidAddedTokenMints));
                        }
                        continue;
                    }
                }
            }
            PendingBasketType::RedeemProcess => {
                for token_amount in token_amounts {
                    if let Some(slot_for_update) = self
                        .token_amounts
                        .iter_mut()
                        .find(|ta| ta.mint == token_amount.mint)
                    {
                        slot_for_update.amount_for_redeeming = slot_for_update
                            .amount_for_redeeming
                            .checked_sub(token_amount.amount_for_redeeming)
                            .ok_or(InvalidShareAmountProvided)?;
                    } else {
                        if needs_to_validate_mint_existence {
                            return Err(error!(InvalidAddedTokenMints));
                        }
                        continue;
                    }
                }
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

    pub fn is_empty(&self) -> bool {
        self.token_amounts
            .iter()
            .all(|ta| ta.amount_for_minting == 0 && ta.amount_for_redeeming == 0)
    }

    pub fn reset(&mut self) {
        self.token_amounts = [TokenAmount::default(); MAX_TOKEN_AMOUNTS];
    }

    pub fn get_clean_token_balance(token_balance: u64, token_amounts: &TokenAmount) -> u64 {
        token_balance
            // Since can't be rolled back, we need to act as if those have already been withdrawn
            .checked_sub(token_amounts.amount_for_redeeming)
            .unwrap()
            // Since can be rolled back, can't take them into account, needs to be removed
            .checked_sub(token_amounts.amount_for_minting)
            .unwrap()
    }
}
