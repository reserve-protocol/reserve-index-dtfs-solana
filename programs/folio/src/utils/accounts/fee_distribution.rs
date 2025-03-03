use anchor_lang::prelude::Pubkey;

use crate::state::FeeDistribution;

impl FeeDistribution {
    /// Check if the fee distribution is fully distributed.
    ///
    /// # Returns
    /// * `bool` - True if all fee recipients are default pubkey, false otherwise.
    pub fn is_fully_distributed(&self) -> bool {
        self.fee_recipients_state
            .iter()
            .all(|f| f.recipient == Pubkey::default())
    }
}
