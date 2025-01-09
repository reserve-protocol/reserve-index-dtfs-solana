use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;
use shared::check_condition;
use shared::constants::DAO_FEE_CONFIG_SEEDS;
use shared::{errors::ErrorCode, structs::FolioStatus};

use crate::state::Folio;
use crate::DtfProgram;

#[derive(Accounts)]
pub struct PokeFolio<'info> {
    pub system_program: Program<'info, System>,

    #[account(mut)]
    pub user: Signer<'info>,

    #[account(mut)]
    pub folio: AccountLoader<'info, Folio>,

    #[account(mut)]
    pub folio_token_mint: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: DTF program
    #[account()]
    pub dtf_program: UncheckedAccount<'info>,

    /// CHECK: DAO fee config
    #[account(
        seeds = [DAO_FEE_CONFIG_SEEDS],
        bump,
        seeds::program = dtf_program.key(),
    )]
    pub dao_fee_config: UncheckedAccount<'info>,
}

impl PokeFolio<'_> {
    pub fn validate(&self, folio: &Folio) -> Result<()> {
        folio.validate_folio_program_post_init(
            &self.folio.key(),
            None,
            None,
            None,
            None,
            None,
            Some(FolioStatus::Initialized),
        )?;

        check_condition!(
            folio.program_version == self.dtf_program.key(),
            InvalidProgram
        );

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

    let (dao_fee_numerator, dao_fee_denominator, _) =
        DtfProgram::get_dao_fee_config(&ctx.accounts.dao_fee_config.to_account_info())?;

    let current_time = Clock::get()?.unix_timestamp;

    folio.poke(
        ctx.accounts.folio_token_mint.supply,
        current_time,
        dao_fee_numerator,
        dao_fee_denominator,
    )?;

    Ok(())
}
