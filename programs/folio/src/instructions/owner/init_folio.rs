use crate::{
    events::FolioCreated,
    state::{Actor, Folio},
    DtfProgram,
};
use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, TokenInterface},
};
use shared::{
    check_condition,
    constants::{ACTOR_SEEDS, FOLIO_SEEDS, MAX_FOLIO_FEE, PROGRAM_REGISTRAR_SEEDS},
    structs::Role,
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

    #[account(
        init,
        payer = folio_owner,
        space = Actor::SIZE,
        seeds = [ACTOR_SEEDS, folio_owner.key().as_ref(), folio.key().as_ref()],
        bump
    )]
    pub actor: Box<Account<'info, Actor>>,

    /*
        Because of solana's limits with stack size, etc.

        the folio token account will be created in finalize folio (if needed)
        the fee_recipients will be created in the update function (if needed)
        the folio_pending_basket will be created in the init tokens (if needed)
    */

    /*
    Account to validate
    */
    #[account(
        seeds = [PROGRAM_REGISTRAR_SEEDS],
        bump = program_registrar.bump
    )]
    pub program_registrar: Box<Account<'info, ProgramRegistrar>>,

    /// CHECK: DTF program used for creating owner record
    #[account()]
    pub dtf_program: UncheckedAccount<'info>,

    /// CHECK: DTF program data to validate program deployment slot
    #[account()]
    pub dtf_program_data: UncheckedAccount<'info>,
}

impl InitFolio<'_> {
    pub fn validate(&self, folio_fee: u64) -> Result<()> {
        Folio::validate_folio_program_for_init(&self.program_registrar, &self.dtf_program)?;

        check_condition!(folio_fee <= MAX_FOLIO_FEE, InvalidFeePerSecond);

        Ok(())
    }
}

pub fn handler(ctx: Context<InitFolio>, folio_fee: u64) -> Result<()> {
    ctx.accounts.validate(folio_fee)?;

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
        folio.folio_fee = folio_fee;
    }

    let actor = &mut ctx.accounts.actor;
    actor.bump = ctx.bumps.actor;
    actor.authority = ctx.accounts.folio_owner.key();
    actor.folio = ctx.accounts.folio.key();
    Role::add_role(&mut actor.roles, Role::Owner);

    emit!(FolioCreated {
        folio_token_mint: ctx.accounts.folio_token_mint.key(),
        folio_fee,
    });

    Ok(())
}
