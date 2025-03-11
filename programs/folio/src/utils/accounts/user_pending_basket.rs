use std::cell::RefMut;

use crate::utils::structs::TokenAmount;
use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address_with_program_id;
use anchor_spl::token::TokenAccount;
use shared::check_condition;
use shared::constants::{PendingBasketType, MAX_USER_PENDING_BASKET_TOKEN_AMOUNTS};
use shared::errors::ErrorCode;
use shared::errors::ErrorCode::InvalidAddedTokenMints;
use shared::errors::ErrorCode::*;
use shared::utils::math_util::Decimal;
use shared::utils::Rounding;

use crate::state::{Folio, FolioBasket, UserPendingBasket};

impl UserPendingBasket {
    /// Process the init if needed, meaning we initialize the account if it's not initialized yet and if it already is
    /// we check if the bump is correct.
    ///
    /// # Arguments
    /// * `account_loader_user_pending_basket` - The account loader for the UserPendingBasket account.
    /// * `context_bump` - The bump of the account provided in the anchor context.
    /// * `owner` - The owner of the UserPendingBasket account.
    /// * `folio` - The folio the UserPendingBasket account belongs to.
    /// * `added_token_amounts` - The token amounts to add to the UserPendingBasket account.
    /// * `can_add_new_mints` - Whether we can add new mints to the UserPendingBasket account.
    #[cfg(not(tarpaulin_include))]
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

    /// Add token amounts to the pending basket of the user. If can add new mints it mean it won't error out if the mint is not in the basket yet.
    ///
    /// # Arguments
    /// * `token_amounts` - The token amounts to add to the pending basket.
    /// * `can_add_new_mints` - Whether we can add new mints to the pending basket.
    /// * `pending_basket_type` - The type of pending basket, wether it's for minting or redeeming.
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

    /// Remove token amounts from the pending basket of the user. If needs to validate mint existence it means it will error out if the mint is not in the basket.
    ///
    /// # Arguments
    /// * `token_amounts` - The token amounts to remove from the pending basket.
    /// * `needs_to_validate_mint_existence` - Whether we need to validate the mint existence within the basket.
    /// * `pending_basket_type` - The type of pending basket, wether it's for minting or redeeming.
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

    /// Reorder the token amounts in the pending basket of the user to match the order of the mints in the ordering vector.
    ///
    /// # Arguments
    /// * `ordering_vec` - The ordering vector to reorder the token amounts.
    pub fn reorder_token_amounts(&mut self, ordering_vec: &[TokenAmount]) -> Result<()> {
        self.token_amounts.sort_by_key(|ta| {
            ordering_vec
                .iter()
                .position(|order_mint| order_mint.mint == ta.mint)
                .unwrap_or(usize::MAX)
        });

        Ok(())
    }

    /// Check if the pending basket of the user is empty. Meaning all the token amounts are 0.
    ///
    /// # Returns
    /// * `bool` - Whether the pending basket of the user is empty.
    pub fn is_empty(&self) -> bool {
        self.token_amounts
            .iter()
            .all(|ta| ta.amount_for_minting == 0 && ta.amount_for_redeeming == 0)
    }

    /// Reset the pending basket of the user to default. Meaning all the token amounts are set to 0 and the mint is set to the default pubkey.
    pub fn reset(&mut self) {
        self.token_amounts = [TokenAmount::default(); MAX_USER_PENDING_BASKET_TOKEN_AMOUNTS];
    }

    /// This function pokes the folio to get the latest pending fee shares, and then calculates the user's pending amounts in shares.
    ///
    /// # Arguments
    /// * `raw_shares` - The shares to convert to assets. (the amount of shares the user wants to redeem or mint) (D9).
    /// * `raw_folio_token_supply` - The folio token supply of the folio token mint (D9).
    /// * `folio_key` - The key of the folio.
    /// * `token_program_id` - The token program id.
    /// * `folio_basket` - The basket of the folio.
    /// * `folio` - The folio.
    /// * `pending_basket_type` - The type of pending basket, wether it's for minting or redeeming.
    /// * `included_tokens` - The tokens currently being processed (sent as remaining accounts).
    /// * `current_time` - The current time.
    /// * `scaled_dao_fee_numerator` - The numerator of the DAO fee (D18).
    /// * `scaled_dao_fee_denominator` - The denominator of the DAO fee (D18).
    /// * `scaled_dao_fee_floor` - The floor of the DAO fee (D18).
    #[allow(clippy::too_many_arguments)]
    #[cfg(not(tarpaulin_include))]
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

            // Get token balance for folio of the token currently being processed
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

    /// Calculate the user's pending amount in shares for minting. This will be removed from the amount_for_minting, so that we take the pending amount
    /// of the user and calculate how many shares of the folio mint token they would get.
    ///
    /// # Arguments
    /// * `raw_user_amount` - The user's pending amount for minting (D9).
    /// * `raw_related_mint_amount` - The folio's amount for minting (D9).
    /// * `scaled_total_supply_folio_token` - The total supply of the folio mint token (D9).
    /// * `scaled_folio_token_balance` - The balance of the folio in folio mint token (D9).
    /// * `raw_shares` - The shares to convert to assets. (the amount of shares the user wants to mint) (D9).
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

        // Remove from pending amounts in both the folio's basket and the user's pending basket
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

    /// Calculate the user's pending amount in shares for redeeming. This will be added to the amount_fo_redeeming, so that the user can redeem them
    /// in multiple steps if needed.
    ///
    /// # Arguments
    /// * `raw_user_amount` - The user's pending amount for redeeming (D9).
    /// * `raw_related_mint_amount` - The folio's amount for redeeming (D9).
    /// * `scaled_total_supply_folio_token` - The total supply of the folio mint token (D9).
    /// * `scaled_folio_token_balance` - The balance of the folio in folio mint token (D9).
    /// * `raw_shares` - The shares to convert to assets. (the amount of shares the user wants to redeem) (D9).
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

        // Add to pending amounts in both the folio's basket and the user's pending basket
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
