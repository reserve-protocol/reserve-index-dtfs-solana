use crate::{
    events::FolioCreated,
    state::{Folio, FolioProgramSigner},
    DtfProgram,
};
use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, TokenAccount, TokenInterface},
};
use shared::{
    check_condition,
    constants::{
        FOLIO_PROGRAM_SIGNER_SEEDS, FOLIO_SEEDS, MAX_PLATFORM_FEE, PROGRAM_REGISTRAR_SEEDS,
    },
};

use crate::state::ProgramRegistrar;
use shared::errors::ErrorCode;

#[derive(Accounts)]
pub struct InitFolio<'info> {
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,

    #[account(mut)]
    pub folio_owner: Signer<'info>,

    #[account(
        seeds = [PROGRAM_REGISTRAR_SEEDS],
        bump = program_registrar.bump
    )]
    pub program_registrar: Box<Account<'info, ProgramRegistrar>>,

    #[account(
        seeds = [FOLIO_PROGRAM_SIGNER_SEEDS],
        bump = folio_program_signer.bump
    )]
    pub folio_program_signer: Box<Account<'info, FolioProgramSigner>>,

    #[account(init,
        payer = folio_owner,
        space = Folio::SIZE,
        seeds = [FOLIO_SEEDS, folio_token_mint.key().as_ref()],
        bump
    )]
    pub folio: AccountLoader<'info, Folio>,

    #[account(init,
    payer = folio_owner,
    mint::decimals = 9,
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

    /*
        Because of solana's limits with stack size, etc.

        the folio_fee_recipients will be created in the update function (if needed)
        the folio_pending_token_amounts will be created in the init tokens (if needed)
    */
    /// CHECK: DTF program used for creating owner record
    #[account()]
    pub dtf_program: UncheckedAccount<'info>,

    /// CHECK: DTF program data to validate program deployment slot
    #[account()]
    pub dtf_program_data: UncheckedAccount<'info>,

    /// CHECK: Will be the first owner of the folio
    #[account(mut)]
    pub first_owner: UncheckedAccount<'info>,
}

impl InitFolio<'_> {
    pub fn validate(&self, fee_per_second: u64) -> Result<()> {
        Folio::validate_folio_program_for_init(&self.program_registrar, &self.dtf_program)?;

        check_condition!(fee_per_second <= MAX_PLATFORM_FEE, InvalidFeePerSecond);

        Ok(())
    }
}

pub fn handler(ctx: Context<InitFolio>, fee_per_second: u64) -> Result<()> {
    ctx.accounts.validate(fee_per_second)?;

    {
        let folio = &mut ctx.accounts.folio.load_init()?;

        let deployment_slot = DtfProgram::get_program_deployment_slot(
            &ctx.accounts.dtf_program.key(),
            &ctx.accounts.dtf_program.to_account_info(),
            &ctx.accounts.dtf_program_data.to_account_info(),
        )?;

        folio.bump = ctx.bumps.folio;
        folio.program_version = ctx.accounts.dtf_program.key();
        folio.program_deployment_slot = deployment_slot;
        folio.folio_token_mint = ctx.accounts.folio_token_mint.key();
        folio.fee_per_second = fee_per_second;
    }

    let folio_signer_bump = ctx.accounts.folio_program_signer.bump;
    let signer_seeds = &[FOLIO_PROGRAM_SIGNER_SEEDS, &[folio_signer_bump]];

    DtfProgram::init_first_owner(
        ctx.accounts.system_program.to_account_info(),
        ctx.accounts.rent.to_account_info(),
        ctx.accounts.folio_owner.to_account_info(),
        ctx.accounts.folio_program_signer.to_account_info(),
        ctx.accounts.first_owner.to_account_info(),
        ctx.accounts.folio.to_account_info(),
        ctx.accounts.dtf_program.to_account_info(),
        signer_seeds,
    )?;

    emit!(FolioCreated {
        folio_token_mint: ctx.accounts.folio_token_mint.key(),
        fee_per_second,
    });

    Ok(())
}
