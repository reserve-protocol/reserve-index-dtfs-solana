use crate::{
    error::ErrorCode,
    events::FolioCreated,
    state::{Folio, FolioProgramSigner},
    DtfProgram,
};
use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_2022::Token2022,
    token_interface::{Mint, TokenAccount},
};

use crate::{check_condition, state::ProgramRegistrar};

#[derive(Accounts)]
pub struct InitFolio<'info> {
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
    pub token_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,

    #[account(mut)]
    pub folio_owner: Signer<'info>,

    #[account(
        seeds = [ProgramRegistrar::SEEDS],
        bump = program_registrar.bump
    )]
    pub program_registrar: Box<Account<'info, ProgramRegistrar>>,

    #[account(
        seeds = [FolioProgramSigner::SEEDS],
        bump = folio_program_signer.bump
    )]
    pub folio_program_signer: Box<Account<'info, FolioProgramSigner>>,

    #[account(init,
        payer = folio_owner,
        space = Folio::SIZE,
        seeds = [Folio::SEEDS, folio_token_mint.key().as_ref()],
        bump
    )]
    pub folio: AccountLoader<'info, Folio>,

    #[account(init,
    payer = folio_owner,
    mint::decimals = 18,
    mint::authority = folio,
    mint::freeze_authority = folio,
    )]
    pub folio_token_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(init,
    payer = folio_owner,
    associated_token::mint = folio_token_mint,
    associated_token::authority = folio,
    )]
    pub folio_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: DTF program used for creating owner record
    #[account()]
    pub dtf_program: UncheckedAccount<'info>,

    /// CHECK: Will be the first owner of the folio
    #[account(mut)]
    pub first_owner: UncheckedAccount<'info>,
}

impl<'info> InitFolio<'info> {
    pub fn validate(&self) -> Result<()> {
        check_condition!(
            self.program_registrar
                .is_in_registrar(self.dtf_program.key()),
            ProgramNotInRegistrar
        );

        Ok(())
    }
}

pub fn handler(ctx: Context<InitFolio>, fee_per_second: u64) -> Result<()> {
    ctx.accounts.validate()?;

    {
        let folio = &mut ctx.accounts.folio.load_init()?;

        folio.bump = ctx.bumps.folio;
        folio.program_version = ctx.accounts.dtf_program.key();
        folio.folio_token_mint = ctx.accounts.folio_token_mint.key();
        folio.circulating_supply = 0;
        folio.fee_per_second = fee_per_second; // TODO: check for maximum fee?
        folio.fee_recipients = [Pubkey::default(); 64];
    }

    let folio_signer_bump = ctx.accounts.folio_program_signer.bump;
    let signer_seeds = &[FolioProgramSigner::SEEDS, &[folio_signer_bump]];

    DtfProgram::init_first_owner(
        ctx.accounts.system_program.to_account_info(),
        ctx.accounts.rent.to_account_info(),
        ctx.accounts.folio_owner.to_account_info(),
        ctx.accounts.folio_program_signer.to_account_info(),
        ctx.accounts.first_owner.to_account_info(),
        ctx.accounts.folio.to_account_info(),
        ctx.accounts.folio_token_mint.to_account_info(),
        ctx.accounts.dtf_program.to_account_info(),
        signer_seeds,
    )?;

    emit!(FolioCreated {
        folio_token_mint: ctx.accounts.folio_token_mint.key(),
        fee_per_second,
    });

    Ok(())
}
