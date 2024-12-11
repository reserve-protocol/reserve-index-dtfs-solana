use anchor_lang::prelude::*;

#[event]
pub struct FolioCreated {
    pub folio_token_mint: Pubkey,
    pub fee_per_second: u64,
}

#[event]
pub struct ProgramRegistryUpdate {
    pub program_ids: Vec<Pubkey>,
    pub remove: bool,
}
