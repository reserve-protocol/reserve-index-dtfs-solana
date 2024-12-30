use anchor_lang::prelude::*;
use anchor_lang::solana_program::bpf_loader_upgradeable;
use folio::ID as FOLIO_ID;
use shared::constants::DTF_PROGRAM_SIGNER_SEEDS;
use shared::errors::ErrorCode;
use shared::structs::Role;
use shared::{check_condition, constants::ACTOR_SEEDS};

use crate::state::{Actor, DtfProgramSigner};
use crate::{FolioProgram, ID as DTF_PROGRAM_ID};

#[derive(Accounts)]
pub struct InitOrUpdateActor<'info> {
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,

    #[account(mut)]
    pub folio_owner: Signer<'info>,

    /// CHECK: Wallet, DAO, multisig that will be the new actor
    #[account()]
    pub new_actor_authority: UncheckedAccount<'info>,

    #[account(mut,
        seeds = [ACTOR_SEEDS, folio_owner.key().as_ref(), folio_owner_actor.folio.key().as_ref()],
        bump = folio_owner_actor.bump,
    )]
    pub folio_owner_actor: Box<Account<'info, Actor>>,

    /*
    Init if needed because we use the same functionality to add roles to the actor
     */
    #[account(init_if_needed,
        payer = folio_owner,
        space = Actor::SIZE,
        seeds = [ACTOR_SEEDS, new_actor_authority.key().as_ref(), folio_owner_actor.folio.key().as_ref()],
        bump
    )]
    pub new_actor: Box<Account<'info, Actor>>,

    /*
    Accounts for validation
     */
    #[account(
        seeds = [DTF_PROGRAM_SIGNER_SEEDS],
        bump = dtf_program_signer.bump
    )]
    pub dtf_program_signer: Account<'info, DtfProgramSigner>,

    /// CHECK: DTF Program
    #[account(address = DTF_PROGRAM_ID)]
    pub dtf_program: UncheckedAccount<'info>,

    /// CHECK: DTF Program Data
    #[account(
        seeds = [DTF_PROGRAM_ID.as_ref()],
        bump,
        seeds::program = &bpf_loader_upgradeable::id()
    )]
    pub dtf_program_data: UncheckedAccount<'info>,

    /// CHECK: Folio Program
    #[account(address = FOLIO_ID)]
    pub folio_program: UncheckedAccount<'info>,

    /// CHECK: Done within the folio program
    #[account(mut)]
    pub folio: UncheckedAccount<'info>,

    /// CHECK: Done within the folio program
    #[account()]
    pub program_registrar: UncheckedAccount<'info>,
}

impl InitOrUpdateActor<'_> {
    pub fn validate(&self) -> Result<()> {
        check_condition!(
            Role::has_role(self.folio_owner_actor.roles, Role::Owner),
            Unauthorized
        );

        Ok(())
    }
}

pub fn handler(ctx: Context<InitOrUpdateActor>, role: Role) -> Result<()> {
    ctx.accounts.validate()?;

    let new_actor = &mut ctx.accounts.new_actor;

    let new_actor_bump = new_actor.bump;

    new_actor.process_init_if_needed(
        new_actor_bump,
        ctx.bumps.new_actor,
        &ctx.accounts.new_actor_authority.key(),
        &ctx.accounts.folio_owner_actor.folio,
    )?;

    Role::add_role(&mut new_actor.roles, role);

    /*
    Call the validate function on the folio progam, it doesn't do much appart from validating
     */
    FolioProgram::validate_mutate_actor_action(
        &ctx.accounts.folio_program.to_account_info(),
        &ctx.accounts.folio_owner.to_account_info(),
        &ctx.accounts.folio_owner_actor.to_account_info(),
        &ctx.accounts.program_registrar.to_account_info(),
        &ctx.accounts.folio.to_account_info(),
        &ctx.accounts.dtf_program_signer,
        &ctx.accounts.dtf_program.to_account_info(),
        &ctx.accounts.dtf_program_data.to_account_info(),
    )?;
    Ok(())
}
