use crate::state::DAOFeeConfig;
use anchor_lang::prelude::*;
use shared::check_condition;
use shared::constants::common::ADMIN;
use shared::constants::DAO_FEE_CONFIG_SEEDS;
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
    pub fn validate(&self) -> Result<()> {
        check_condition!(self.admin.key() == ADMIN, Unauthorized);

        Ok(())
    }
}

pub fn handler(
    ctx: Context<SetDAOFeeConfig>,
    fee_recipient: Option<Pubkey>,
    fee_recipient_numerator: Option<u64>,
) -> Result<()> {
    ctx.accounts.validate()?;

    let dao_fee_config = &mut ctx.accounts.dao_fee_config;

    DAOFeeConfig::init_or_update_dao_fee_config(
        dao_fee_config,
        ctx.bumps.dao_fee_config,
        fee_recipient,
        fee_recipient_numerator,
    )?;

    Ok(())
}
