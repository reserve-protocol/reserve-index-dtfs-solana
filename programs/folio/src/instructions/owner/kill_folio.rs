use crate::events::FolioKilled;
use crate::state::{Actor, Folio, ProgramRegistrar};
use anchor_lang::prelude::*;
use shared::structs::FolioStatus;
use shared::{
    constants::{ACTOR_SEEDS, DTF_PROGRAM_SIGNER_SEEDS, PROGRAM_REGISTRAR_SEEDS},
    structs::Role,
};

#[derive(Accounts)]
pub struct KillFolio<'info> {
    pub system_program: Program<'info, System>,

    #[account(mut)]
    pub folio_owner: Signer<'info>,

    /*
    Account to validate
    */
    #[account(
        seeds = [DTF_PROGRAM_SIGNER_SEEDS],
        bump,
        seeds::program = dtf_program.key(),
    )]
    pub dtf_program_signer: Signer<'info>,

    /// CHECK: DTF program used for creating owner record
    #[account()]
    pub dtf_program: UncheckedAccount<'info>,

    /// CHECK: DTF program data to validate program deployment slot
    #[account()]
    pub dtf_program_data: UncheckedAccount<'info>,

    #[account(
        seeds = [PROGRAM_REGISTRAR_SEEDS],
        bump = program_registrar.bump
    )]
    pub program_registrar: Box<Account<'info, ProgramRegistrar>>,

    #[account(
        seeds = [ACTOR_SEEDS, folio_owner.key().as_ref(), folio.key().as_ref()],
        bump = actor.bump,
    )]
    pub actor: Account<'info, Actor>,

    #[account(mut)]
    pub folio: AccountLoader<'info, Folio>,
}

impl KillFolio<'_> {
    pub fn validate(&self, folio: &Folio) -> Result<()> {
        folio.validate_folio_program_post_init(
            &self.folio.key(),
            Some(&self.program_registrar),
            Some(&self.dtf_program),
            Some(&self.dtf_program_data),
            Some(&self.actor),
            Some(Role::Owner),
            Some(vec![FolioStatus::Initialized, FolioStatus::Initializing]),
        )?;

        Ok(())
    }
}

pub fn handler(ctx: Context<KillFolio>) -> Result<()> {
    let folio = &mut ctx.accounts.folio.load_mut()?;
    ctx.accounts.validate(folio)?;
    folio.status = FolioStatus::Killed as u8;

    emit!(FolioKilled {});

    Ok(())
}
