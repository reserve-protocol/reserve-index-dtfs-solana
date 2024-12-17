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

    #[account(
        mut,
        seeds = [FOLIO_SEEDS, folio_token_mint.key().as_ref()],
        bump,
    )]
    pub folio: AccountLoader<'info, Folio>,

    /// CHECK: Folio token mint
    #[account()]
    pub folio_token_mint: AccountInfo<'info>,

    /// CHECK: DTF program used for creating owner record
    #[account()]
    pub dtf_program: UncheckedAccount<'info>,

    /// CHECK: DTF program data to validate program deployment slot
    #[account()]
    pub dtf_program_data: UncheckedAccount<'info>,
}

impl<'info> FinishInitTokensForFolio<'info> {
    pub fn validate(&self, folio_bump: u8) -> Result<()> {
        let folio = self.folio.load()?;
        folio.validate_folio_program_post_init(
            &self.program_registrar,
            &self.dtf_program,
            &self.dtf_program_data,
            Some(folio_bump),
            Some(&self.actor.to_account_info()),
            Some(Role::Owner),
            Some(FolioStatus::Initializing), // Can only finish initializing while it's initializing
        )?;

        Ok(())
    }
}

pub fn handler(ctx: Context<FinishInitTokensForFolio>) -> Result<()> {
    ctx.accounts.validate(ctx.bumps.folio)?;

    let folio = &mut ctx.accounts.folio.load_mut()?;

    folio.status = FolioStatus::Initialized as u8;

    Ok(())
}
