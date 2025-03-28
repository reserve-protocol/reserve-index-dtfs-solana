use crate::events::BasketTokenRemoved;
use crate::state::FolioBasket;
use crate::FolioTokenAmount;
use anchor_lang::prelude::*;
use shared::check_condition;
use shared::constants::MAX_FOLIO_TOKEN_AMOUNTS;
use shared::errors::ErrorCode;
use shared::errors::ErrorCode::*;

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
        added_folio_token_amounts: &Vec<FolioTokenAmount>,
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
            folio_basket.token_amounts = [FolioTokenAmount::default(); MAX_FOLIO_TOKEN_AMOUNTS];

            folio_basket.add_tokens_to_basket(added_folio_token_amounts)?;
        } else {
            let folio_basket = &mut account_loader_folio_basket.load_mut()?;

            check_condition!(folio_basket.bump == context_bump, InvalidBump);

            folio_basket.add_tokens_to_basket(added_folio_token_amounts)?;
        }

        Ok(())
    }

    /// Add tokens to the basket by setting the token mint.
    /// Will error out if the basket is full or if trying to add the default pubkey.
    ///
    /// # Arguments
    /// * `folio_token_amounts` - The mints to add to the basket.
    ///
    /// # Returns
    pub fn add_tokens_to_basket(
        &mut self,
        folio_token_amounts: &Vec<FolioTokenAmount>,
    ) -> Result<()> {
        for folio_token_amount in folio_token_amounts {
            check_condition!(
                folio_token_amount.mint != Pubkey::default(),
                InvalidAddedTokenMints
            );

            let token_is_present = self
                .token_amounts
                .iter_mut()
                .find(|ta| ta.mint == folio_token_amount.mint);

            if let Some(slot_to_update) = token_is_present {
                slot_to_update.amount = slot_to_update
                    .amount
                    .checked_add(folio_token_amount.amount)
                    .ok_or(ErrorCode::MathOverflow)?;

                continue;
            }

            let empty_slot = self
                .token_amounts
                .iter_mut()
                .find(|ta| ta.mint == Pubkey::default());

            if let Some(slot) = empty_slot {
                slot.mint = folio_token_amount.mint;
                slot.amount = folio_token_amount.amount;
                continue;
            }

            return Err(error!(MaxNumberOfTokensReached));
        }

        Ok(())
    }

    /// Reduce the amount of tokens in the basket.
    ///
    /// # Arguments
    /// * `folio_token_amounts` - The mints to remove from the basket.
    ///
    /// # Returns
    pub fn remove_tokens_from_basket(
        &mut self,
        folio_token_amounts: &Vec<FolioTokenAmount>,
    ) -> Result<()> {
        for folio_token_amount in folio_token_amounts {
            if let Some(slot_to_update) = self
                .token_amounts
                .iter_mut()
                .find(|ta| ta.mint == folio_token_amount.mint)
            {
                slot_to_update.amount = slot_to_update
                    .amount
                    .checked_sub(folio_token_amount.amount)
                    .ok_or(ErrorCode::MathOverflow)?;

                if slot_to_update.amount == 0 {
                    slot_to_update.mint = Pubkey::default();
                    emit!(BasketTokenRemoved {
                        token: folio_token_amount.mint
                    });
                }
            } else {
                // Token haven't been found
                return Err(error!(InvalidRemovedTokenMints));
            }
        }

        Ok(())
    }

    /// Remove all amounts from the basket for the given mints.
    ///
    /// # Arguments
    /// mints: The mints to tokens to remove from folio completely
    ///
    pub fn remove_all_amounts_from_basket(&mut self, mints: &Vec<Pubkey>) -> Result<()> {
        for mint in mints {
            if let Some(slot_to_update) = self.token_amounts.iter_mut().find(|ta| ta.mint == *mint)
            {
                slot_to_update.amount = 0;
                slot_to_update.mint = Pubkey::default();
                emit!(BasketTokenRemoved { token: *mint });
            } else {
                // Token haven't been found
                return Err(error!(InvalidRemovedTokenMints));
            }
        }

        Ok(())
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

    /// Get the token amount in the basket.
    /// Will error out if the token mint is not found.
    /// Is used for migrating, sell in Bid, etc.
    ///
    /// # Arguments
    /// * `mint` - The mint to get the balance for.
    ///
    /// # Returns the token amount in the basket
    pub fn get_token_amount_in_folio_basket(&self, mint: &Pubkey) -> Result<u64> {
        let token_amount = self.token_amounts.iter().find(|ta| ta.mint == *mint);

        if let Some(token_amount) = token_amount {
            Ok(token_amount.amount)
        } else {
            Err(error!(TokenMintNotInOldFolioBasket))
        }
    }

    /// Get the token amount in the basket or zero if the token mint is not found.
    ///
    /// # Arguments
    /// * `mint` - The mint to get the balance for.
    ///
    /// # Returns the token amount in the basket or zero if the token mint is not found.
    pub fn get_token_amount_in_folio_basket_or_zero(&self, mint: &Pubkey) -> u64 {
        self.get_token_amount_in_folio_basket(mint).unwrap_or(0)
    }
}
