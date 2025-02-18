use crate::state::{DAOFeeConfig, FolioFeeConfig};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;
use shared::check_condition;
use shared::constants::common::ADMIN;
use shared::constants::{
    DAO_FEE_CONFIG_SEEDS, FOLIO_FEE_CONFIG_SEEDS, FOLIO_PROGRAM_ID, FOLIO_SEEDS, MAX_DAO_FEE,
    MAX_FEE_FLOOR,
};
use shared::errors::ErrorCode;

#[derive(Accounts)]
pub struct SetFolioFeeConfig<'info> {
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,

    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        seeds = [DAO_FEE_CONFIG_SEEDS],
        bump = dao_fee_config.bump
    )]
    pub dao_fee_config: Account<'info, DAOFeeConfig>,

    /// CHECK: Folio token mint
    #[account()]
    pub folio_token_mint: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: Folio account
    #[account(
        seeds = [FOLIO_SEEDS, folio_token_mint.key().as_ref()],
        bump,
        seeds::program = FOLIO_PROGRAM_ID,
    )]
    pub folio: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = admin,
        space = FolioFeeConfig::SIZE,
        seeds = [FOLIO_FEE_CONFIG_SEEDS, folio.key().as_ref()],
        bump
    )]
    pub folio_fee_config: Account<'info, FolioFeeConfig>,
}

impl SetFolioFeeConfig<'_> {
    pub fn validate(&self, fee_numerator: &Option<u128>, fee_floor: &Option<u128>) -> Result<()> {
        check_condition!(self.admin.key() == ADMIN, Unauthorized);

        if let Some(fee_numerator) = fee_numerator {
            check_condition!(*fee_numerator <= MAX_DAO_FEE, InvalidFeeNumerator);
        }

        if let Some(fee_floor) = fee_floor {
            check_condition!(*fee_floor <= MAX_FEE_FLOOR, InvalidFeeFloor);
        }

        Ok(())
    }
}

pub fn handler(
    ctx: Context<SetFolioFeeConfig>,
    fee_numerator: Option<u128>,
    fee_floor: Option<u128>,
) -> Result<()> {
    ctx.accounts.validate(&fee_numerator, &fee_floor)?;

    let folio_fee_config = &mut ctx.accounts.folio_fee_config;

    FolioFeeConfig::init_or_update_folio_fee_config(
        folio_fee_config,
        &ctx.accounts.dao_fee_config,
        ctx.bumps.folio_fee_config,
        fee_numerator,
        fee_floor,
    )?;

    Ok(())
}
