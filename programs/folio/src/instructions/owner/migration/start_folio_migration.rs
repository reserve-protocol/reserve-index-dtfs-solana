use crate::ID as FOLIO_PROGRAM_ID;
use crate::{
    state::{Actor, Folio},
    utils::{FolioStatus, Role},
};
use anchor_lang::{prelude::*, Discriminator};
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

/// Start Folio Migration
/// Folio owner
///
/// # Arguments
/// * `system_program` - The system program.
/// * `token_program` - The token program.
/// * `folio_owner` - The folio owner account (mut, signer).
/// * `program_registrar` - The program registrar account (not mut, not signer).
/// * `new_folio_program` - The new folio program (executable).
/// * `old_folio` - The old folio account (PDA) (mut, not signer).
/// * `new_folio` - The new folio account (mut, not signer).
/// * `folio_token_mint` - The folio token mint account (mut, not signer).
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
    /// Validate the instruction.
    ///
    /// # Checks
    /// * Old folio has the correct status and is owned by the folio owner.
    /// * Token mint is the same as the one on the old folio.
    /// * New folio program is in the registrar.
    /// * New folio is owned by the new folio program.
    /// * New folio program is not the same as the old folio program.
    pub fn validate(&self, old_folio: &Folio) -> Result<()> {
        // Validate old folio, make sure the owner is the one calling the instruction
        old_folio.validate_folio(
            &self.old_folio.key(),
            Some(&self.actor),
            Some(vec![Role::Owner]),
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

        // Make sure the discriminator of the new folio is correct
        let data = self.new_folio.try_borrow_data()?;
        check_condition!(
            data.len() >= 8 && data[0..8] == Folio::discriminator(),
            InvalidNewFolio
        );

        Ok(())
    }
}

/// Start Folio Migration. This will be called to initiate the migration process.
/// The start of the migration process will transfer the mint and freeze authority to the new folio.
///
/// # Arguments
/// * `ctx` - The context of the instruction.
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

    // No need to transfer tokens of the folio token mint, as the folio is minting / burning, never holding them.

    Ok(())
}
