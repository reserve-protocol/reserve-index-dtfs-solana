use crate::state::{Actor, Folio};
use anchor_lang::prelude::*;
use shared::{
    constants::{ACTOR_SEEDS, DTF_PROGRAM_SIGNER_SEEDS, PROGRAM_REGISTRAR_SEEDS},
    structs::Role,
};

use crate::state::ProgramRegistrar;

#[derive(Accounts)]
pub struct RemoveActor<'info> {
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,

    #[account(mut)]
    pub folio_owner: Signer<'info>,

    /// CHECK: Wallet, DAO, multisig
    #[account()]
    pub actor_authority: UncheckedAccount<'info>,

    #[account(mut,
        seeds = [ACTOR_SEEDS, folio_owner.key().as_ref(), folio_owner_actor.folio.key().as_ref()],
        bump = folio_owner_actor.bump,
    )]
    pub folio_owner_actor: Box<Account<'info, Actor>>,

    #[account(mut,
        seeds = [ACTOR_SEEDS, actor_authority.key().as_ref(), folio_owner_actor.folio.key().as_ref()],
        bump = actor_to_remove.bump,
    )]
    pub actor_to_remove: Box<Account<'info, Actor>>,

    #[account(
        seeds = [PROGRAM_REGISTRAR_SEEDS],
        bump = program_registrar.bump
    )]
    pub program_registrar: Box<Account<'info, ProgramRegistrar>>,

    #[account()]
    pub folio: AccountLoader<'info, Folio>,

    /// CHECK: DTF program used for creating owner record
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

impl RemoveActor<'_> {
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

pub fn handler(ctx: Context<RemoveActor>, role: Role, close_actor: bool) -> Result<()> {
    ctx.accounts.validate()?;

    let actor_to_remove = &mut ctx.accounts.actor_to_remove;

    if !close_actor {
        Role::remove_role(&mut actor_to_remove.roles, role);
    } else {
        // To prevent re-init attacks, we re-init the actor with default values
        actor_to_remove.reset();

        actor_to_remove.close(ctx.accounts.folio_owner.to_account_info())?;
    }

    Ok(())
}
