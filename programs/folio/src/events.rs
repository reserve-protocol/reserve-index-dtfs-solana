use anchor_lang::prelude::*;

#[event]
pub struct FolioCreated {
    pub folio_token_mint: Pubkey,
    pub folio_fee: u64,
}

#[event]
pub struct ProgramRegistryUpdate {
    pub program_ids: Vec<Pubkey>,
    pub remove: bool,
}

#[event]
pub struct BasketTokenAdded {
    pub token: Pubkey,
}

#[event]
pub struct BasketTokenRemoved {
    pub token: Pubkey,
}

#[event]
pub struct FolioFeeSet {
    pub new_fee: u64,
}

#[event]
pub struct FeeRecipientSet {
    pub recipient: Pubkey,
    pub portion: u64,
}
