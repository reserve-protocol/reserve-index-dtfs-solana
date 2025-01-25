use crate::{FolioProgram, ID as DTF_PROGRAM_ID};
use anchor_lang::prelude::*;
use anchor_lang::solana_program::bpf_loader_upgradeable;
use folio::ID as FOLIO_ID;
use shared::constants::DTF_PROGRAM_SIGNER_SEEDS;
use shared::structs::Role;

use crate::state::DtfProgramSigner;

#[derive(Accounts)]
pub struct RemoveActor<'info> {
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,

    #[account(mut)]
    pub folio_owner: Signer<'info>,

    /// CHECK: Wallet, DAO, multisig
    #[account()]
    pub actor_authority: UncheckedAccount<'info>,

    /// CHECK: Done within the folio program
    #[account()]
    pub folio_owner_actor: UncheckedAccount<'info>,

    /// CHECK: Done within the folio program
    #[account(mut)]
    pub actor_to_remove: UncheckedAccount<'info>,

    /*
    DTF Program Accounts
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

    /*
    Folio Program Accounts
    */
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

impl RemoveActor<'_> {
    pub fn validate(&self) -> Result<()> {
        Ok(())
    }
}

pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, RemoveActor<'info>>,
    role: Role,
    close_actor: bool,
) -> Result<()> {
    ctx.accounts.validate()?;

    FolioProgram::remove_actor(ctx, role, close_actor)?;

    Ok(())
}
