use anchor_lang::prelude::*;
use shared::errors::ErrorCode;
use shared::{check_condition, constants::AUCTION_ENDS_SEEDS};

use crate::state::{Auction, AuctionEnds};

impl AuctionEnds {
    pub fn keys_pair_in_order(sell_token: Pubkey, buy_token: Pubkey) -> (Pubkey, Pubkey) {
        if sell_token < buy_token {
            (sell_token, buy_token)
        } else {
            (buy_token, sell_token)
        }
    }

    pub fn process_init_if_needed(
        &mut self,
        bump: u8,
        sell_token: Pubkey,
        buy_token: Pubkey,
        rebalance_nonce: u64,
    ) -> Result<()> {
        let (token_mint_1, token_mint_2) = AuctionEnds::keys_pair_in_order(sell_token, buy_token);

        self.bump = bump;
        self.rebalance_nonce = rebalance_nonce;
        self.token_mint_1 = token_mint_1;
        self.token_mint_2 = token_mint_2;
        self.end_time = 0;

        Ok(())
    }

    pub fn validate_auction_ends(
        &self,
        auction_ends_pubkey: &Pubkey,
        auction: &Auction,
    ) -> Result<()> {
        let bump = self.validate_auction_ends_with_keys_and_get_bump(
            auction_ends_pubkey,
            auction.sell_mint,
            auction.buy_mint,
            auction.nonce,
        )?;
        check_condition!(self.bump == bump, InvalidPda);

        Ok(())
    }

    pub fn validate_auction_ends_with_keys_and_get_bump(
        &self,
        auction_ends_pubkey: &Pubkey,
        sell_token: Pubkey,
        buy_token: Pubkey,
        rebalance_nonce: u64,
    ) -> Result<u8> {
        let keys = AuctionEnds::keys_pair_in_order(sell_token, buy_token);

        let pubkey = Pubkey::find_program_address(
            &[
                AUCTION_ENDS_SEEDS,
                &rebalance_nonce.to_le_bytes(),
                keys.0.to_bytes().as_ref(),
                keys.1.to_bytes().as_ref(),
            ],
            &crate::id(),
        );
        check_condition!(*auction_ends_pubkey == pubkey.0, InvalidPda);
        Ok(self.bump)
    }
}
