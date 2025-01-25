use crate::state::{Actor, Folio};
use anchor_lang::prelude::*;
use shared::{
    constants::{ACTOR_SEEDS, DTF_PROGRAM_SIGNER_SEEDS, PROGRAM_REGISTRAR_SEEDS},
    structs::Role,
};

use crate::state::ProgramRegistrar;

#[derive(Accounts)]
pub struct InitOrUpdateActor<'info> {
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,

    #[account(mut)]
    pub folio_owner: Signer<'info>,

    /// CHECK: Wallet, DAO, multisig that will be the new actor
    #[account()]
    pub new_actor_authority: UncheckedAccount<'info>,

    #[account(
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

    #[account()]
    pub folio: AccountLoader<'info, Folio>,

    /*
    Accounts to validate
    */
    #[account(
        seeds = [PROGRAM_REGISTRAR_SEEDS],
        bump = program_registrar.bump
    )]
    pub program_registrar: Box<Account<'info, ProgramRegistrar>>,

    /// CHECK: DTF program used
    #[account()]
    pub dtf_program: UncheckedAccount<'info>,

    #[account(
        seeds = [DTF_PROGRAM_SIGNER_SEEDS],
        bump,
        seeds::program = dtf_program.key(),
    )]
    pub dtf_program_signer: Signer<'info>,

    /// CHECK: DTF program data to validate program deployment slot
    #[account()]
    pub dtf_program_data: UncheckedAccount<'info>,
}

impl InitOrUpdateActor<'_> {
    pub fn validate(&self) -> Result<()> {
        let folio = &self.folio.load()?;

        folio.validate_folio_program_post_init(
            &self.folio.key(),
            Some(&self.program_registrar),
            Some(&self.dtf_program),
            Some(&self.dtf_program_data),
            Some(&self.folio_owner_actor),
            Some(Role::Owner),
            None, // Can CRUD actors no matter the status
        )?;

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

    Ok(())
}
