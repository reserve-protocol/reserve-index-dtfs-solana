use anchor_lang::prelude::*;

/// Event emitted when the program registrar is updated.
#[event]
pub struct ProgramRegistryUpdate {
    pub program_ids: Vec<Pubkey>,
    pub remove: bool,
}
