use crate::utils::structs::FolioStatus;
use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;
use folio_admin::state::DAOFeeConfig;
use shared::check_condition;
use shared::constants::{DAO_FEE_CONFIG_SEEDS, FOLIO_FEE_CONFIG_SEEDS};
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

    /// CHECK: Could be empty or could be set, if set we use that one, else we use dao fee config
    #[account(
            seeds = [FOLIO_FEE_CONFIG_SEEDS, folio.key().as_ref()],
            bump,
            seeds::program = FOLIO_ADMIN_PROGRAM_ID,
        )]
    pub folio_fee_config: UncheckedAccount<'info>,

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

    let fee_details = ctx
        .accounts
        .dao_fee_config
        .get_fee_details(&ctx.accounts.folio_fee_config)?;

    folio.poke(
        ctx.accounts.folio_token_mint.supply,
        current_time,
        fee_details.fee_numerator,
        fee_details.fee_denominator,
        fee_details.fee_floor,
    )?;

    Ok(())
}
