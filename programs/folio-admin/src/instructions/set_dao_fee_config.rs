use crate::state::DAOFeeConfig;
use anchor_lang::prelude::*;
use shared::check_condition;
use shared::constants::common::ADMIN;
use shared::constants::{DAO_FEE_CONFIG_SEEDS, MAX_DAO_FEE, MAX_FEE_FLOOR};
use shared::errors::ErrorCode;

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
    pub fn validate(
        &self,
        default_fee_numerator: &Option<u128>,
        default_fee_floor: &Option<u128>,
    ) -> Result<()> {
        check_condition!(self.admin.key() == ADMIN, Unauthorized);

        if let Some(default_fee_numerator) = default_fee_numerator {
            check_condition!(*default_fee_numerator <= MAX_DAO_FEE, InvalidFeeNumerator);
        }

        if let Some(default_fee_floor) = default_fee_floor {
            check_condition!(*default_fee_floor <= MAX_FEE_FLOOR, InvalidFeeFloor);
        }

        Ok(())
    }
}

pub fn handler(
    ctx: Context<SetDAOFeeConfig>,
    fee_recipient: Option<Pubkey>,
    default_fee_numerator: Option<u128>,
    default_fee_floor: Option<u128>,
) -> Result<()> {
    ctx.accounts
        .validate(&default_fee_numerator, &default_fee_floor)?;

    let dao_fee_config = &mut ctx.accounts.dao_fee_config;

    DAOFeeConfig::init_or_update_dao_fee_config(
        dao_fee_config,
        ctx.bumps.dao_fee_config,
        fee_recipient,
        default_fee_numerator,
        default_fee_floor,
    )?;

    Ok(())
}
