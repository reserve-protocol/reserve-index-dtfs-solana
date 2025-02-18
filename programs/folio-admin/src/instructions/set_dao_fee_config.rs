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
        fee_recipient_numerator: &Option<u128>,
        fee_floor: &Option<u128>,
    ) -> Result<()> {
        check_condition!(self.admin.key() == ADMIN, Unauthorized);

        if let Some(fee_recipient_numerator) = fee_recipient_numerator {
            check_condition!(*fee_recipient_numerator <= MAX_DAO_FEE, InvalidFeeNumerator);
        }

        if let Some(fee_floor) = fee_floor {
            check_condition!(*fee_floor <= MAX_FEE_FLOOR, InvalidFeeFloor);
        }

        Ok(())
    }
}

pub fn handler(
    ctx: Context<SetDAOFeeConfig>,
    fee_recipient: Option<Pubkey>,
    fee_recipient_numerator: Option<u128>,
    fee_floor: Option<u128>,
) -> Result<()> {
    ctx.accounts
        .validate(&fee_recipient_numerator, &fee_floor)?;

    let dao_fee_config = &mut ctx.accounts.dao_fee_config;

    DAOFeeConfig::init_or_update_dao_fee_config(
        dao_fee_config,
        ctx.bumps.dao_fee_config,
        fee_recipient,
        fee_recipient_numerator,
        fee_floor,
    )?;

    Ok(())
}
