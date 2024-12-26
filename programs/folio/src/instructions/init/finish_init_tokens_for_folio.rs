use crate::state::{Folio, ProgramRegistrar};
use anchor_lang::prelude::*;
use shared::structs::FolioStatus;
use shared::{
    constants::{ACTOR_SEEDS, DTF_PROGRAM_SIGNER_SEEDS, FOLIO_SEEDS, PROGRAM_REGISTRAR_SEEDS},
    structs::Role,
};

#[derive(Accounts)]
pub struct FinishInitTokensForFolio<'info> {
    pub system_program: Program<'info, System>,

    #[account(mut)]
    pub folio_owner: Signer<'info>,

    /// CHECK: Actor for folio owner
    #[account(mut,
        seeds = [ACTOR_SEEDS, folio_owner.key().as_ref(), folio.key().as_ref()],
        bump,
        seeds::program = dtf_program.key()
    )]
    pub actor: AccountInfo<'info>,

    #[account(
        seeds = [DTF_PROGRAM_SIGNER_SEEDS],
        bump,
        seeds::program = dtf_program.key(),
    )]
    pub dtf_program_signer: Signer<'info>,

    #[account(
        seeds = [PROGRAM_REGISTRAR_SEEDS],
        bump = program_registrar.bump
    )]
    pub program_registrar: Box<Account<'info, ProgramRegistrar>>,

    #[account(mut)]
    pub folio: AccountLoader<'info, Folio>,

    /// CHECK: DTF program used for creating owner record
    #[account()]
    pub dtf_program: UncheckedAccount<'info>,

    /// CHECK: DTF program data to validate program deployment slot
    #[account()]
    pub dtf_program_data: UncheckedAccount<'info>,
}

impl<'info> FinishInitTokensForFolio<'info> {
    pub fn validate(&self) -> Result<()> {
        let folio = self.folio.load()?;
        folio.validate_folio_program_post_init(
            &self.folio.key(),
            Some(&self.program_registrar),
            Some(&self.dtf_program),
            Some(&self.dtf_program_data),
            Some(&self.actor.to_account_info()),
            Some(Role::Owner),
            Some(FolioStatus::Initializing), // Can only finish initializing while it's initializing
        )?;

        Ok(())
    }
}

pub fn handler(ctx: Context<FinishInitTokensForFolio>) -> Result<()> {
    ctx.accounts.validate()?;

    let folio = &mut ctx.accounts.folio.load_mut()?;

    folio.status = FolioStatus::Initialized as u8;

    Ok(())
}
