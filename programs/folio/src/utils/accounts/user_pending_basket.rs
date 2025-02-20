use std::cell::RefMut;

use crate::utils::math_util::Decimal;
use crate::utils::structs::TokenAmount;
use crate::utils::Rounding;
use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address_with_program_id;
use anchor_spl::token::TokenAccount;
use shared::check_condition;
use shared::constants::{PendingBasketType, MAX_USER_PENDING_BASKET_TOKEN_AMOUNTS};
use shared::errors::ErrorCode;
use shared::errors::ErrorCode::InvalidAddedTokenMints;
use shared::errors::ErrorCode::*;

use crate::state::{Folio, FolioBasket, UserPendingBasket};

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

    /// This function pokes the folio to get the latest pending fee shares, and then converts the user's pending amounts to assets.
    #[allow(clippy::too_many_arguments)]
    pub fn to_assets(
        &mut self,
        raw_shares: u64,
        raw_folio_token_supply: u64,
        folio_key: &Pubkey,
        token_program_id: &Pubkey,
        folio_basket: &mut RefMut<'_, FolioBasket>,
        folio: &mut RefMut<'_, Folio>,
        pending_basket_type: PendingBasketType,
        included_tokens: &&[AccountInfo<'_>],
        // Also pokes the folio, to make sure we get the latest fee shares
        current_time: i64,
        scaled_dao_fee_numerator: u128,
        scaled_dao_fee_denominator: u128,
        scaled_dao_fee_floor: u128,
    ) -> Result<()> {
        // Poke the folio to make sure we get the latest fee shares
        folio.poke(
            raw_folio_token_supply,
            current_time,
            scaled_dao_fee_numerator,
            scaled_dao_fee_denominator,
            scaled_dao_fee_floor,
        )?;

        let scaled_total_supply_folio_token = folio.get_total_supply(raw_folio_token_supply)?;

        for (index, folio_token_account) in included_tokens.iter().enumerate() {
            let related_mint = &mut folio_basket.token_amounts[index];

            check_condition!(
                folio_token_account.key()
                    == get_associated_token_address_with_program_id(
                        folio_key,
                        &related_mint.mint,
                        token_program_id,
                    ),
                InvalidRecipientTokenAccount
            );

            let raw_user_amount = &mut self.token_amounts[index];

            check_condition!(raw_user_amount.mint == related_mint.mint, MintMismatch);

            // Get token balance for folio
            let data = folio_token_account.try_borrow_data()?;
            let folio_token_account = TokenAccount::try_deserialize(&mut &data[..])?;

            let raw_folio_token_balance =
                FolioBasket::get_clean_token_balance(folio_token_account.amount, related_mint)?;

            let scaled_folio_token_balance = Decimal::from_token_amount(raw_folio_token_balance)?;

            match pending_basket_type {
                PendingBasketType::MintProcess => {
                    UserPendingBasket::to_assets_for_minting(
                        raw_user_amount,
                        related_mint,
                        &scaled_total_supply_folio_token,
                        &scaled_folio_token_balance,
                        raw_shares,
                    )?;
                }
                PendingBasketType::RedeemProcess => {
                    UserPendingBasket::to_assets_for_redeeming(
                        raw_user_amount,
                        related_mint,
                        &scaled_total_supply_folio_token,
                        &scaled_folio_token_balance,
                        raw_shares,
                    )?;
                }
            }
        }

        Ok(())
    }

    pub fn to_assets_for_minting(
        raw_user_amount: &mut TokenAmount,
        raw_related_mint_amount: &mut TokenAmount,
        scaled_total_supply_folio_token: &Decimal,
        scaled_folio_token_balance: &Decimal,
        raw_shares: u64,
    ) -> Result<()> {
        let scaled_calculated_shares =
            Decimal::from_token_amount(raw_user_amount.amount_for_minting)?
                .mul(scaled_total_supply_folio_token)?
                .div(scaled_folio_token_balance)?;

        check_condition!(
            scaled_calculated_shares.to_token_amount(Rounding::Floor)?.0 >= raw_shares,
            InvalidShareAmountProvided
        );

        // {tok} = {share} * {tok} / {share}
        let raw_user_amount_taken = Decimal::from_token_amount(raw_shares)?
            .mul(scaled_folio_token_balance)?
            .div(scaled_total_supply_folio_token)?
            .to_token_amount(Rounding::Ceiling)?;

        // Remove from both pending amounts
        raw_user_amount.amount_for_minting = raw_user_amount
            .amount_for_minting
            .checked_sub(raw_user_amount_taken.0)
            .ok_or(ErrorCode::MathOverflow)?;
        raw_related_mint_amount.amount_for_minting = raw_related_mint_amount
            .amount_for_minting
            .checked_sub(raw_user_amount_taken.0)
            .ok_or(ErrorCode::MathOverflow)?;

        Ok(())
    }

    pub fn to_assets_for_redeeming(
        raw_user_amount: &mut TokenAmount,
        raw_related_mint_amount: &mut TokenAmount,
        scaled_total_supply_folio_token: &Decimal,
        scaled_folio_token_balance: &Decimal,
        raw_shares: u64,
    ) -> Result<()> {
        let raw_amount_to_give_to_user = Decimal::from_token_amount(raw_shares)?
            .mul(scaled_folio_token_balance)?
            .div(scaled_total_supply_folio_token)?
            .to_token_amount(Rounding::Floor)?;

        // Add to both pending amounts for redeeming
        raw_user_amount.amount_for_redeeming = raw_user_amount
            .amount_for_redeeming
            .checked_add(raw_amount_to_give_to_user.0)
            .ok_or(ErrorCode::MathOverflow)?;
        raw_related_mint_amount.amount_for_redeeming = raw_related_mint_amount
            .amount_for_redeeming
            .checked_add(raw_amount_to_give_to_user.0)
            .ok_or(ErrorCode::MathOverflow)?;

        Ok(())
    }
}
