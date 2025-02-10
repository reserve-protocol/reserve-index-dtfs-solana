use anchor_lang::prelude::Pubkey;

use crate::state::FeeDistribution;

impl FeeDistribution {
    pub fn is_fully_distributed(&self) -> bool {
        self.fee_recipients_state
            .iter()
            .all(|f| f.recipient == Pubkey::default())
    }
}
