use std::cell::RefMut;

use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address_with_program_id;
use anchor_spl::token::TokenAccount;
use shared::check_condition;
use shared::constants::{PendingBasketType, MAX_TOKEN_AMOUNTS};
use shared::errors::ErrorCode;
use shared::errors::ErrorCode::InvalidAddedTokenMints;
use shared::errors::ErrorCode::*;
use shared::structs::{DecimalValue, Rounding, TokenAmount};

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
                            slot.decimals = token_amount.decimals;
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
                            slot.decimals = token_amount.decimals;
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

    pub fn to_assets<'info>(
        &mut self,
        shares: DecimalValue,
        folio_key: &Pubkey,
        token_program_id: &Pubkey,
        folio_pending_basket: &mut RefMut<'_, PendingBasket>,
        decimal_total_supply_folio_token: &DecimalValue,
        pending_basket_type: PendingBasketType,
        included_tokens: &&[AccountInfo<'info>],
    ) -> Result<()> {
        for (index, folio_token_account) in included_tokens.iter().enumerate() {
            let related_mint = &mut folio_pending_basket.token_amounts[index];

            check_condition!(
                folio_token_account.key()
                    == get_associated_token_address_with_program_id(
                        &folio_key,
                        &related_mint.mint,
                        &token_program_id,
                    ),
                InvalidReceiverTokenAccount
            );

            // Get user amount (validate mint)
            let user_amount = &mut self.token_amounts[index];

            check_condition!(user_amount.mint == related_mint.mint, MintMismatch);

            // Get token balance for folio
            let data = folio_token_account.try_borrow_data()?;
            let folio_token_account = TokenAccount::try_deserialize(&mut &data[..])?;

            let folio_token_balance =
                PendingBasket::get_clean_token_balance(folio_token_account.amount, related_mint);

            let decimal_folio_token_balance =
                DecimalValue::from_token_amount(folio_token_balance, related_mint.decimals);

            match pending_basket_type {
                PendingBasketType::MintProcess => {
                    PendingBasket::to_assets_for_minting(
                        user_amount,
                        related_mint,
                        decimal_total_supply_folio_token,
                        &decimal_folio_token_balance,
                        shares,
                    )?;
                }
                PendingBasketType::RedeemProcess => {
                    PendingBasket::to_assets_for_redeeming(
                        user_amount,
                        related_mint,
                        decimal_total_supply_folio_token,
                        &decimal_folio_token_balance,
                        shares,
                    )?;
                }
            }
        }

        Ok(())
    }

    fn to_assets_for_minting(
        user_amount: &mut TokenAmount,
        related_mint: &mut TokenAmount,
        decimal_total_supply_folio_token: &DecimalValue,
        decimal_folio_token_balance: &DecimalValue,
        shares: DecimalValue,
    ) -> Result<()> {
        let calculated_shares =
            DecimalValue::from_token_amount(user_amount.amount_for_minting, related_mint.decimals)
                .mul_div(
                    &decimal_total_supply_folio_token,
                    &decimal_folio_token_balance,
                )
                .unwrap();

        check_condition!(calculated_shares >= shares, InvalidShareAmountProvided);

        let user_amount_taken = shares
            .mul_div(
                decimal_folio_token_balance,
                decimal_total_supply_folio_token,
            )
            .unwrap()
            .to_token_amount(related_mint.decimals, Rounding::Ceil);

        // Remove from both pending amounts
        user_amount.amount_for_minting = user_amount
            .amount_for_minting
            .checked_sub(user_amount_taken)
            .unwrap();
        related_mint.amount_for_minting = related_mint
            .amount_for_minting
            .checked_sub(user_amount_taken)
            .unwrap();

        Ok(())
    }

    fn to_assets_for_redeeming(
        user_amount: &mut TokenAmount,
        related_mint: &mut TokenAmount,
        decimal_total_supply_folio_token: &DecimalValue,
        decimal_folio_token_balance: &DecimalValue,
        shares: DecimalValue,
    ) -> Result<()> {
        let amount_to_give_to_user = shares
            .mul_div(
                &decimal_folio_token_balance,
                &decimal_total_supply_folio_token,
            )
            .unwrap()
            .to_token_amount(related_mint.decimals, Rounding::Floor);

        // Add to both pending amounts for redeeming
        user_amount.amount_for_redeeming = user_amount
            .amount_for_redeeming
            .checked_add(amount_to_give_to_user)
            .unwrap();
        related_mint.amount_for_redeeming = related_mint
            .amount_for_redeeming
            .checked_add(amount_to_give_to_user)
            .unwrap();

        Ok(())
    }
}
