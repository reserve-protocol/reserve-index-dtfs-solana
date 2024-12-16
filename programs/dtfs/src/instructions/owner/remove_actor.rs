use crate::{FolioProgram, ID as DTF_PROGRAM_ID};
use anchor_lang::prelude::*;
use anchor_lang::solana_program::bpf_loader_upgradeable;
use folio::state::ProgramRegistrar;
use folio::ID as FOLIO_ID;
use shared::constants::common::ADMIN;
use shared::constants::{DTF_PROGRAM_SIGNER_SEEDS, FOLIO_SEEDS, PROGRAM_REGISTRAR_SEEDS};
use shared::errors::ErrorCode;
use shared::structs::Role;
use shared::{check_condition, constants::ACTOR_SEEDS};

use crate::state::{Actor, DtfProgramSigner};

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
    pub dtf_program: AccountInfo<'info>,

    /// CHECK: DTF Program Data
    #[account(
        seeds = [DTF_PROGRAM_ID.as_ref()],
        bump,
        seeds::program = &bpf_loader_upgradeable::id()
    )]
    pub dtf_program_data: AccountInfo<'info>,

    /// CHECK: Folio Program
    #[account(address = FOLIO_ID)]
    pub folio_program: AccountInfo<'info>,

    /// CHECK: Folio
    #[account(mut,
        seeds = [FOLIO_SEEDS, folio_token_mint.key().as_ref()],
        bump,
        seeds::program = FOLIO_ID
    )]
    pub folio: AccountInfo<'info>,

    /// CHECK: Folio Token Mint
    #[account()]
    pub folio_token_mint: AccountInfo<'info>,

    #[account(
        seeds = [PROGRAM_REGISTRAR_SEEDS],
        bump = program_registrar.bump,
        seeds::program = FOLIO_ID
    )]
    pub program_registrar: Account<'info, ProgramRegistrar>,
}

impl<'info> RemoveActor<'info> {
    pub fn validate(&self) -> Result<()> {
        check_condition!(
            Role::has_role(self.folio_owner_actor.roles, Role::Owner),
            Unauthorized
        );

        Ok(())
    }
}

pub fn handler(ctx: Context<RemoveActor>, role: Role, close_actor: bool) -> Result<()> {
    ctx.accounts.validate()?;

    let actor_to_remove = &mut ctx.accounts.actor_to_remove;

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

    if !close_actor {
        Role::remove_role(&mut actor_to_remove.roles, role);
    } else {
        // To prevent re-init attacks, we re-init the actor with default values
        actor_to_remove.reset();

        actor_to_remove.close(ctx.accounts.folio_owner.to_account_info())?;
    }

    Ok(())
}
