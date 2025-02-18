use crate::utils::structs::FolioStatus;
use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;
use folio_admin::state::DAOFeeConfig;
use shared::check_condition;
use shared::constants::{DAO_FEE_CONFIG_SEEDS, FEE_DENOMINATOR};
use shared::errors::ErrorCode;

use crate::state::Folio;
use folio_admin::ID as FOLIO_ADMIN_PROGRAM_ID;

#[derive(Accounts)]
pub struct PokeFolio<'info> {
    pub system_program: Program<'info, System>,

    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        seeds = [DAO_FEE_CONFIG_SEEDS],
        bump,
        seeds::program = FOLIO_ADMIN_PROGRAM_ID,
    )]
    pub dao_fee_config: Account<'info, DAOFeeConfig>,

    #[account(mut)]
    pub folio: AccountLoader<'info, Folio>,

    #[account(mut)]
    pub folio_token_mint: Box<InterfaceAccount<'info, Mint>>,
}

impl PokeFolio<'_> {
    pub fn validate(&self, folio: &Folio) -> Result<()> {
        folio.validate_folio(
            &self.folio.key(),
            None,
            None,
            Some(vec![FolioStatus::Initialized, FolioStatus::Killed]),
        )?;

        check_condition!(
            self.folio_token_mint.key() == folio.folio_token_mint,
            InvalidFolioTokenMint
        );

        Ok(())
    }
}

pub fn handler<'info>(ctx: Context<'_, '_, 'info, 'info, PokeFolio<'info>>) -> Result<()> {
    let folio = &mut ctx.accounts.folio.load_mut()?;

    ctx.accounts.validate(folio)?;

    let current_time = Clock::get()?.unix_timestamp;

    let dao_fee_config = &ctx.accounts.dao_fee_config;

    let dao_fee_numerator = dao_fee_config.fee_recipient_numerator;
    let dao_fee_denominator = FEE_DENOMINATOR;
    let dao_fee_floor = dao_fee_config.fee_floor;

    folio.poke(
        ctx.accounts.folio_token_mint.supply,
        current_time,
        dao_fee_numerator,
        dao_fee_denominator,
        dao_fee_floor,
    )?;

    Ok(())
}
