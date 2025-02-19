use anchor_lang::prelude::*;

use instructions::*;
pub mod events;
pub mod instructions;
pub mod state;
pub mod utils;

declare_id!("7ZqvG9KKhzA3ykto2WMYuw3waWuaydKwYKHYSf7SiFbn");

#[program]
pub mod folio_admin {

    use super::*;

    pub fn init_program_registrar(
        ctx: Context<InitProgramRegistrar>,
        program_id: Pubkey,
    ) -> Result<()> {
        init_program_registrar::handler(ctx, program_id)
    }

    pub fn update_program_registrar(
        ctx: Context<UpdateProgramRegistrar>,
        program_ids: Vec<Pubkey>,
        remove: bool,
    ) -> Result<()> {
        update_program_registrar::handler(ctx, program_ids, remove)
    }

    pub fn set_dao_fee_config(
        ctx: Context<SetDAOFeeConfig>,
        fee_recipient: Option<Pubkey>,
        scaled_default_fee_numerator: Option<u128>,
        scaled_default_fee_floor: Option<u128>,
    ) -> Result<()> {
        set_dao_fee_config::handler(
            ctx,
            fee_recipient,
            scaled_default_fee_numerator,
            scaled_default_fee_floor,
        )
    }

    pub fn set_folio_fee_config(
        ctx: Context<SetFolioFeeConfig>,
        scaled_fee_numerator: Option<u128>,
        scaled_fee_floor: Option<u128>,
    ) -> Result<()> {
        set_folio_fee_config::handler(ctx, scaled_fee_numerator, scaled_fee_floor)
    }
}
