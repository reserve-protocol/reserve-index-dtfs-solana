use crate::state::DAOFeeConfig;
use anchor_lang::prelude::*;
use shared::check_condition;
use shared::constants::common::ADMIN;
use shared::constants::{DAO_FEE_CONFIG_SEEDS, MAX_DAO_FEE, MAX_FEE_FLOOR};
use shared::errors::ErrorCode;

/// Set the DAO fee config.
///
/// # Arguments
/// * `system_program` - The system program.
/// * `rent` - The rent sysvar.
/// * `admin` - The admin account (mut, signer).
/// * `dao_fee_config` - The DAO fee config account (PDA) (init_if_needed, not signer).
#[derive(Accounts)]
pub struct SetDAOFeeConfig<'info> {
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,

    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init_if_needed,
        payer = admin,
        space = DAOFeeConfig::SIZE,
        seeds = [DAO_FEE_CONFIG_SEEDS],
        bump
    )]
    pub dao_fee_config: Account<'info, DAOFeeConfig>,
}

impl SetDAOFeeConfig<'_> {
    /// Validate the instruction.
    ///
    /// # Checks
    /// * Admin account is the authorized admin.
    /// * Fee numerator is less than or equal to the max DAO fee.
    /// * Fee floor is less than or equal to the max fee floor.
    pub fn validate(
        &self,
        scaled_default_fee_numerator: &Option<u128>,
        scaled_default_fee_floor: &Option<u128>,
    ) -> Result<()> {
        check_condition!(self.admin.key() == ADMIN, Unauthorized);

        if let Some(scaled_default_fee_numerator) = scaled_default_fee_numerator {
            check_condition!(
                *scaled_default_fee_numerator <= MAX_DAO_FEE,
                InvalidFeeNumerator
            );
        }

        if let Some(scaled_default_fee_floor) = scaled_default_fee_floor {
            check_condition!(*scaled_default_fee_floor <= MAX_FEE_FLOOR, InvalidFeeFloor);
        }

        Ok(())
    }
}

/// Set the DAO fee config.
///
/// # Arguments
/// * `ctx` - The context of the instruction.
/// * `fee_recipient` - The fee recipient of the DAO.
/// * `scaled_default_fee_numerator` - The default fee numerator of the DAO, scaled in D18.
/// * `scaled_default_fee_floor` - The default fee floor of the DAO, scaled in D18.
pub fn handler(
    ctx: Context<SetDAOFeeConfig>,
    fee_recipient: Option<Pubkey>,
    scaled_default_fee_numerator: Option<u128>,
    scaled_default_fee_floor: Option<u128>,
) -> Result<()> {
    ctx.accounts
        .validate(&scaled_default_fee_numerator, &scaled_default_fee_floor)?;

    let dao_fee_config = &mut ctx.accounts.dao_fee_config;

    DAOFeeConfig::init_or_update_dao_fee_config(
        dao_fee_config,
        ctx.bumps.dao_fee_config,
        fee_recipient,
        scaled_default_fee_numerator,
        scaled_default_fee_floor,
    )?;

    Ok(())
}
