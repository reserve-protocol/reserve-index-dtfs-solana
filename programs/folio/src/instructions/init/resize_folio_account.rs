use crate::state::Folio;
use anchor_lang::prelude::*;
use shared::{
    constants::{ACTOR_SEEDS, DTF_PROGRAM_SIGNER_SEEDS, FOLIO_SEEDS, PROGRAM_REGISTRAR_SEEDS},
    structs::Role,
};

use crate::state::ProgramRegistrar;

#[derive(Accounts)]
#[instruction(new_size: u64)]
pub struct ResizeFolioAccount<'info> {
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,

    #[account(mut)]
    pub folio_owner: Signer<'info>,

    /// CHECK: Actor
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
        realloc = new_size as usize,
        realloc::payer = folio_owner,
        realloc::zero = false,
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

impl<'info> ResizeFolioAccount<'info> {
    pub fn validate(&self, folio_bump: u8) -> Result<()> {
        let folio = self.folio.load()?;
        folio.validate_folio_program_post_init(
            &self.program_registrar,
            &self.dtf_program,
            &self.dtf_program_data,
            Some(folio_bump),
            Some(&self.actor.to_account_info()),
            Some(Role::Owner),
            None, // Can resize no matter the status
        )?;

        Ok(())
    }
}

pub fn handler(ctx: Context<ResizeFolioAccount>, _new_size: u64) -> Result<()> {
    ctx.accounts.validate(ctx.bumps.folio)?;

    Ok(())
}
