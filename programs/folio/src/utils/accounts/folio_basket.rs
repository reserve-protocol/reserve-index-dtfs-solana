use crate::utils::structs::TokenAmount;
use anchor_lang::prelude::*;
use shared::check_condition;
use shared::constants::{PendingBasketType, MAX_FOLIO_TOKEN_AMOUNTS};
use shared::errors::ErrorCode;
use shared::errors::ErrorCode::InvalidAddedTokenMints;
use shared::errors::ErrorCode::*;

use crate::events::BasketTokenRemoved;
use crate::state::FolioBasket;

impl FolioBasket {
    /// Process the init if needed, meaning we initialize the account if it's not initialized yet and if it already is
    /// we check if the bump is correct.
    ///
    /// # Arguments
    /// * `account_loader_folio_basket` - The account loader for the folio basket.
    /// * `context_bump` - The bump of the account provided in the anchor context.
    /// * `folio` - The folio the folio basket belongs to.
    /// * `added_mints` - The mints to add to the folio basket.
    #[cfg(not(tarpaulin_include))]
    pub fn process_init_if_needed(
        account_loader_folio_basket: &mut AccountLoader<FolioBasket>,
        context_bump: u8,
        folio: &Pubkey,
        added_mints: &Vec<Pubkey>,
    ) -> Result<()> {
        let account_info_folio_basket = account_loader_folio_basket.to_account_info();

        let data = account_info_folio_basket.try_borrow_mut_data()?;
        let mut disc_bytes = [0u8; 8];
        disc_bytes.copy_from_slice(&data[..8]);

        let discriminator = u64::from_le_bytes(disc_bytes);

        drop(data);

        if discriminator == 0 {
            // Not initialized yet
            let folio_basket = &mut account_loader_folio_basket.load_init()?;

            folio_basket.bump = context_bump;
            folio_basket.folio = *folio;
            folio_basket.token_amounts = [TokenAmount::default(); MAX_FOLIO_TOKEN_AMOUNTS];

            folio_basket.add_tokens_to_basket(added_mints)?;
        } else {
            let folio_basket = &mut account_loader_folio_basket.load_mut()?;

            check_condition!(folio_basket.bump == context_bump, InvalidBump);

            folio_basket.add_tokens_to_basket(added_mints)?;
        }

        Ok(())
    }

    /// Add tokens to the basket by setting the token mint.
    /// Will error out if the basket is full or if trying to add the default pubkey.
    ///
    /// # Arguments
    /// * `mints` - The mints to add to the basket.
    ///
    /// # Returns
    pub fn add_tokens_to_basket(&mut self, mints: &Vec<Pubkey>) -> Result<()> {
        for mint in mints {
            check_condition!(*mint != Pubkey::default(), InvalidAddedTokenMints);

            if self.token_amounts.iter_mut().any(|ta| ta.mint == *mint) {
                // Continue if already exists
                continue;
            } else if let Some(slot) = self
                .token_amounts
                .iter_mut()
                .find(|ta| ta.mint == Pubkey::default())
            {
                slot.mint = *mint;
                slot.amount_for_minting = 0;
                slot.amount_for_redeeming = 0;
            } else {
                // No available slot found, return an error
                return Err(error!(MaxNumberOfTokensReached));
            }
        }

        Ok(())
    }

    /// Remove tokens from the basket by setting the amounts to 0 and the pubkey to the default pubkey.
    /// Will error out if the token is not found.
    ///
    /// # Arguments
    /// * `mints` - The mints to remove from the basket.
    ///
    /// # Returns
    pub fn remove_tokens_from_basket(&mut self, mints: &Vec<Pubkey>) -> Result<()> {
        for mint in mints {
            if let Some(slot_to_remove) = self.token_amounts.iter_mut().find(|ta| ta.mint == *mint)
            {
                slot_to_remove.mint = Pubkey::default();
                slot_to_remove.amount_for_minting = 0;
                slot_to_remove.amount_for_redeeming = 0;

                emit!(BasketTokenRemoved { token: mint.key() });
            } else {
                // Token haven't been found
                return Err(error!(InvalidRemovedTokenMints));
            }
        }

        Ok(())
    }

    /// Add token amounts to the folio basket, this can be done for minting or redeeming.
    /// They are separate amounts to avoid complex operations when trying to get the folio balances, etc.
    /// Will error out if the token mint is not found.
    ///
    /// # Arguments
    /// * `token_amounts` - The token amounts to add to the basket.
    /// * `pending_basket_type` - The type of pending basket.
    pub fn add_token_amounts_to_basket(
        &mut self,
        token_amounts: &Vec<TokenAmount>,
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
                        slot_for_update.amount_for_minting = token_amount
                            .amount_for_minting
                            .checked_add(slot_for_update.amount_for_minting)
                            .ok_or(ErrorCode::MathOverflow)?;
                    }
                    PendingBasketType::RedeemProcess => {
                        slot_for_update.amount_for_redeeming = token_amount
                            .amount_for_redeeming
                            .checked_add(slot_for_update.amount_for_redeeming)
                            .ok_or(ErrorCode::MathOverflow)?;
                    }
                }
            } else {
                // Can't add token amounts of an unsupported mint
                return Err(error!(InvalidAddedTokenMints));
            }
        }

        Ok(())
    }

    /// Remove token amounts from the folio basket, this can be done for minting or redeeming.
    /// They are separate amounts to avoid complex operations when trying to get the folio balances, etc.
    /// Will error out if the token mint is not found and if the needs_to_validate_mint_existence is true.
    ///
    /// # Arguments
    /// * `token_amounts` - The token amounts to remove from the basket.
    /// * `needs_to_validate_mint_existence` - Whether to validate the mint existence.
    /// * `pending_basket_type` - The type of pending basket.
    pub fn remove_token_amounts_from_folio(
        &mut self,
        token_amounts: &Vec<TokenAmount>,
        needs_to_validate_mint_existence: bool,
        pending_basket_type: PendingBasketType,
    ) -> Result<()> {
        // We can let tokens be removed even if the mint doesn't exist as the user might have coins that have been removed from the basket.
        for token_amount in token_amounts {
            if let Some(slot_for_update) = self
                .token_amounts
                .iter_mut()
                .find(|ta| ta.mint == token_amount.mint)
            {
                match pending_basket_type {
                    PendingBasketType::MintProcess => {
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

    /// Get the clean token balance by subtracting the sum of the tokens amounts from the raw token balance.
    ///
    /// # Arguments
    /// * `raw_token_balance` - The token balance (D9)
    /// * `token_amounts` - The token amounts to subtract from the token balance.
    ///
    /// # Returns the "clean" token balance in D9
    pub fn get_clean_token_balance(
        raw_token_balance: u64,
        token_amounts: &TokenAmount,
    ) -> Result<u64> {
        raw_token_balance
            // Since can't be rolled back, we need to act as if those have already been withdrawn
            .checked_sub(token_amounts.amount_for_redeeming)
            .ok_or(ErrorCode::MathOverflow)?
            // Since can be rolled back, can't take them into account, needs to be removed
            .checked_sub(token_amounts.amount_for_minting)
            .ok_or(ErrorCode::MathOverflow.into())
    }

    /// Get the total number of mints in the basket.
    ///
    /// # Returns the total number of mints in the basket (non default pubkey).
    pub fn get_total_number_of_mints(&self) -> u8 {
        self.token_amounts
            .iter()
            .filter(|ta| ta.mint != Pubkey::default())
            .count() as u8
    }

    /// Get the non pending balance by subtracting the token amounts from the token balance.
    /// Will error out if the token mint is not found.
    /// Is used for migrating, sell in Bid, etc.
    ///
    /// # Arguments
    /// * `raw_token_balance` - The token balance (D9)
    /// * `mint` - The mint to get the balance for.
    ///
    /// # Returns the non pending balance in D9
    pub fn get_non_pending_balance(&self, raw_token_balance: u64, mint: &Pubkey) -> Result<u64> {
        let token_amount = self.token_amounts.iter().find(|ta| ta.mint == *mint);

        if let Some(token_amount) = token_amount {
            FolioBasket::get_clean_token_balance(raw_token_balance, token_amount)
        } else {
            Err(error!(TokenMintNotInOldFolioBasket))
        }
    }
}
