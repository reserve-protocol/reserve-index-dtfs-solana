use crate::ID as FOLIO_PROGRAM_ID;
use crate::{
    state::{Actor, Folio},
    utils::{FolioStatus, Role},
};
use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::spl_token_2022::instruction::AuthorityType,
    token_interface::{self, Mint, TokenInterface},
};
use folio_admin::{state::ProgramRegistrar, ID as FOLIO_ADMIN_PROGRAM_ID};
use shared::errors::ErrorCode;
use shared::{
    check_condition,
    constants::{ACTOR_SEEDS, FOLIO_SEEDS, PROGRAM_REGISTRAR_SEEDS},
};

#[derive(Accounts)]
pub struct StartFolioMigration<'info> {
    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,

    #[account(mut)]
    pub folio_owner: Signer<'info>,

    #[account(
        seeds = [PROGRAM_REGISTRAR_SEEDS],
        bump = program_registrar.bump,
        seeds::program = FOLIO_ADMIN_PROGRAM_ID,
    )]
    pub program_registrar: Box<Account<'info, ProgramRegistrar>>,

    /// CHECK: Folio program used for new folio
    #[account(executable)]
    pub new_folio_program: UncheckedAccount<'info>,

    #[account(
        seeds = [ACTOR_SEEDS, folio_owner.key().as_ref(), old_folio.key().as_ref()],
        bump = actor.bump,
    )]
    pub actor: Account<'info, Actor>,

    #[account(mut)]
    pub old_folio: AccountLoader<'info, Folio>,

    /// CHECK: The new folio
    #[account(mut)]
    pub new_folio: UncheckedAccount<'info>,

    #[account(mut,
    mint::authority = old_folio,
    mint::freeze_authority = old_folio,
    )]
    pub folio_token_mint: Box<InterfaceAccount<'info, Mint>>,
}

impl StartFolioMigration<'_> {
    pub fn validate(&self, old_folio: &Folio) -> Result<()> {
        // Validate old folio, make sure the owner is the one calling the instruction
        old_folio.validate_folio(
            &self.old_folio.key(),
            Some(&self.actor),
            Some(Role::Owner),
            Some(vec![FolioStatus::Initialized, FolioStatus::Killed]),
        )?;

        check_condition!(
            old_folio.folio_token_mint == self.folio_token_mint.key(),
            InvalidFolioTokenMint
        );

        /*
        New Folio Validation
         */
        // Make sure the new folio program is in the registrar
        check_condition!(
            self.program_registrar
                .is_in_registrar(self.new_folio_program.key()),
            ProgramNotInRegistrar
        );

        // Make sure the new folio is owned by the new folio program
        check_condition!(
            *self.new_folio.owner == self.new_folio_program.key(),
            NewFolioNotOwnedByNewFolioProgram
        );

        check_condition!(
            self.new_folio_program.key() != FOLIO_PROGRAM_ID,
            CantMigrateToSameProgram
        );

        Ok(())
    }
}

pub fn handler(ctx: Context<StartFolioMigration>) -> Result<()> {
    let old_folio_bump: u8;
    {
        let old_folio = &mut ctx.accounts.old_folio.load_mut()?;

        old_folio_bump = old_folio.bump;

        ctx.accounts.validate(old_folio)?;

        // Update old folio status
        old_folio.status = FolioStatus::Migrating as u8;
    }

    // Transfer the mint and freeze authority to the new folio
    let token_mint_key = ctx.accounts.folio_token_mint.key();

    let folio_signer_seeds = &[FOLIO_SEEDS, token_mint_key.as_ref(), &[old_folio_bump]];
    let folio_signer = &[&folio_signer_seeds[..]];

    token_interface::set_authority(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token_interface::SetAuthority {
                current_authority: ctx.accounts.old_folio.to_account_info(),
                account_or_mint: ctx.accounts.folio_token_mint.to_account_info(),
            },
            folio_signer,
        ),
        AuthorityType::MintTokens,
        Some(ctx.accounts.new_folio.key()),
    )?;

    token_interface::set_authority(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token_interface::SetAuthority {
                current_authority: ctx.accounts.old_folio.to_account_info(),
                account_or_mint: ctx.accounts.folio_token_mint.to_account_info(),
            },
            folio_signer,
        ),
        AuthorityType::FreezeAccount,
        Some(ctx.accounts.new_folio.key()),
    )?;

    // No need to transfer tokens of the folio token mint, as we're minting / burning, never holding them.

    Ok(())
}
