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

/// Set the Folio fee config.
///
/// # Arguments
/// * `system_program` - The system program.
/// * `rent` - The rent sysvar.
/// * `admin` - The admin account (mut, signer).
/// * `dao_fee_config` - The DAO fee config account (PDA) (not mut, not signer).
/// * `folio_token_mint` - The folio token mint account (not mut, not signer).
/// * `folio` - The folio account (PDA) (not mut, not signer).
/// * `folio_fee_config` - The folio fee config account (PDA) (init_if_needed, not signer).

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
    /// Validate the instruction.
    ///
    /// # Checks
    /// * Admin account is the authorized admin.
    /// * Fee numerator is less than or equal to the max DAO fee.
    /// * Fee floor is less than or equal to the max fee floor.
    pub fn validate(
        &self,
        scaled_fee_numerator: &Option<u128>,
        scaled_fee_floor: &Option<u128>,
    ) -> Result<()> {
        check_condition!(self.admin.key() == ADMIN, Unauthorized);

        if let Some(scaled_fee_numerator) = scaled_fee_numerator {
            check_condition!(*scaled_fee_numerator <= MAX_DAO_FEE, InvalidFeeNumerator);
        }

        if let Some(scaled_fee_floor) = scaled_fee_floor {
            check_condition!(*scaled_fee_floor <= MAX_FEE_FLOOR, InvalidFeeFloor);
        }

        Ok(())
    }
}

/// Set the Folio fee config.
///
/// # Arguments
/// * `ctx` - The context of the instruction.
/// * `scaled_fee_numerator` - The fee numerator of the Folio, scaled in D18.
/// * `scaled_fee_floor` - The fee floor of the Folio, scaled in D18.
pub fn handler(
    ctx: Context<SetFolioFeeConfig>,
    scaled_fee_numerator: Option<u128>,
    scaled_fee_floor: Option<u128>,
) -> Result<()> {
    ctx.accounts
        .validate(&scaled_fee_numerator, &scaled_fee_floor)?;

    let folio_fee_config = &mut ctx.accounts.folio_fee_config;

    FolioFeeConfig::init_or_update_folio_fee_config(
        folio_fee_config,
        &ctx.accounts.dao_fee_config,
        ctx.bumps.folio_fee_config,
        scaled_fee_numerator,
        scaled_fee_floor,
    )?;

    Ok(())
}
