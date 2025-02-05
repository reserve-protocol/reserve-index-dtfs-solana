use std::cell::RefMut;

use crate::utils::math_util::CustomPreciseNumber;
use crate::utils::structs::TokenAmount;
use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address_with_program_id;
use anchor_spl::token::TokenAccount;
use shared::check_condition;
use shared::constants::{PendingBasketType, MAX_USER_PENDING_BASKET_TOKEN_AMOUNTS};
use shared::errors::ErrorCode;
use shared::errors::ErrorCode::InvalidAddedTokenMints;
use shared::errors::ErrorCode::*;

use crate::state::{FolioBasket, UserPendingBasket};

impl UserPendingBasket {
    pub fn process_init_if_needed(
        account_loader_user_pending_basket: &mut AccountLoader<UserPendingBasket>,
        context_bump: u8,
        owner: &Pubkey,
        folio: &Pubkey,
        added_token_amounts: &Vec<TokenAmount>,
        can_add_new_mints: bool,
    ) -> Result<()> {
        let account_info_user_pending_basket = account_loader_user_pending_basket.to_account_info();

        let data = account_info_user_pending_basket.try_borrow_mut_data()?;
        let mut disc_bytes = [0u8; 8];
        disc_bytes.copy_from_slice(&data[..8]);

        let discriminator = u64::from_le_bytes(disc_bytes);

        drop(data);

        if discriminator == 0 {
            // Not initialized yet
            let user_pending_basket = &mut account_loader_user_pending_basket.load_init()?;

            user_pending_basket.bump = context_bump;
            user_pending_basket.owner = *owner;
            user_pending_basket.folio = *folio;
            user_pending_basket.token_amounts =
                [TokenAmount::default(); MAX_USER_PENDING_BASKET_TOKEN_AMOUNTS];

            user_pending_basket.add_token_amounts_to_folio(
                added_token_amounts,
                can_add_new_mints,
                PendingBasketType::MintProcess,
            )?;
        } else {
            let user_pending_basket = &mut account_loader_user_pending_basket.load_mut()?;

            check_condition!(user_pending_basket.bump == context_bump, InvalidBump);

            user_pending_basket.add_token_amounts_to_folio(
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
                            .ok_or(ErrorCode::MathOverflow)?;
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
                            .ok_or(ErrorCode::MathOverflow)?;
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
        for token_amount in token_amounts {
            if let Some(slot_for_update) = self
                .token_amounts
                .iter_mut()
                .find(|ta| ta.mint == token_amount.mint)
            {
                match pending_basket_type {
                    PendingBasketType::MintProcess => {
                        // Will crash if trying to remove more than actual balance
                        slot_for_update.amount_for_minting = slot_for_update
                            .amount_for_minting
                            .checked_sub(token_amount.amount_for_minting)
                            .ok_or(InvalidShareAmountProvided)?;
                    }
                    PendingBasketType::RedeemProcess => {
                        slot_for_update.amount_for_redeeming = slot_for_update
                            .amount_for_redeeming
                            .checked_sub(token_amount.amount_for_redeeming)
                            .ok_or(InvalidShareAmountProvided)?;
                    }
                }
            } else if needs_to_validate_mint_existence {
                return Err(error!(InvalidRemovedTokenMints));
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
        self.token_amounts = [TokenAmount::default(); MAX_USER_PENDING_BASKET_TOKEN_AMOUNTS];
    }

    #[allow(clippy::too_many_arguments)]
    pub fn to_assets(
        &mut self,
        shares: u64,
        folio_key: &Pubkey,
        token_program_id: &Pubkey,
        folio_basket: &mut RefMut<'_, FolioBasket>,
        total_supply_folio_token: u64,
        pending_basket_type: PendingBasketType,
        included_tokens: &&[AccountInfo<'_>],
    ) -> Result<()> {
        for (index, folio_token_account) in included_tokens.iter().enumerate() {
            let related_mint = &mut folio_basket.token_amounts[index];

            check_condition!(
                folio_token_account.key()
                    == get_associated_token_address_with_program_id(
                        folio_key,
                        &related_mint.mint,
                        token_program_id,
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
                FolioBasket::get_clean_token_balance(folio_token_account.amount, related_mint)?;

            match pending_basket_type {
                PendingBasketType::MintProcess => {
                    UserPendingBasket::to_assets_for_minting(
                        user_amount,
                        related_mint,
                        total_supply_folio_token,
                        folio_token_balance,
                        shares,
                    )?;
                }
                PendingBasketType::RedeemProcess => {
                    UserPendingBasket::to_assets_for_redeeming(
                        user_amount,
                        related_mint,
                        total_supply_folio_token,
                        folio_token_balance,
                        shares,
                    )?;
                }
            }
        }

        Ok(())
    }

    pub fn to_assets_for_minting(
        user_amount: &mut TokenAmount,
        related_mint: &mut TokenAmount,
        total_supply_folio_token: u64,
        folio_token_balance: u64,
        shares: u64,
    ) -> Result<()> {
        let calculated_shares = CustomPreciseNumber::from_u64(user_amount.amount_for_minting)?
            .mul_generic(total_supply_folio_token)?
            .div_generic(folio_token_balance)?
            .to_u64_floor()?;

        check_condition!(calculated_shares >= shares, InvalidShareAmountProvided);

        let user_amount_taken = CustomPreciseNumber::from_u64(shares)?
            .mul_generic(folio_token_balance)?
            .div_generic(total_supply_folio_token)?
            .to_u64_ceil()?;

        // Remove from both pending amounts
        user_amount.amount_for_minting = user_amount
            .amount_for_minting
            .checked_sub(user_amount_taken)
            .ok_or(ErrorCode::MathOverflow)?;
        related_mint.amount_for_minting = related_mint
            .amount_for_minting
            .checked_sub(user_amount_taken)
            .ok_or(ErrorCode::MathOverflow)?;

        Ok(())
    }

    pub fn to_assets_for_redeeming(
        user_amount: &mut TokenAmount,
        related_mint: &mut TokenAmount,
        total_supply_folio_token: u64,
        folio_token_balance: u64,
        shares: u64,
    ) -> Result<()> {
        let amount_to_give_to_user = CustomPreciseNumber::from_u64(shares)?
            .mul_generic(folio_token_balance)?
            .div_generic(total_supply_folio_token)?
            .to_u64_floor()?;

        // Add to both pending amounts for redeeming
        user_amount.amount_for_redeeming = user_amount
            .amount_for_redeeming
            .checked_add(amount_to_give_to_user)
            .ok_or(ErrorCode::MathOverflow)?;
        related_mint.amount_for_redeeming = related_mint
            .amount_for_redeeming
            .checked_add(amount_to_give_to_user)
            .ok_or(ErrorCode::MathOverflow)?;

        Ok(())
    }
}
