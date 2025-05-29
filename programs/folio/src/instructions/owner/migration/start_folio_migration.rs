use crate::utils::{Metaplex, NewFolioProgram, UpdateAuthority};
use crate::ID as FOLIO_PROGRAM_ID;
use crate::{
    state::{Actor, Folio},
    utils::{FolioStatus, Role},
};
use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::instructions;
use anchor_spl::token::Token;
use anchor_spl::token_2022_extensions::token_metadata::token_metadata_update_authority;
use anchor_spl::token_interface::spl_pod::optional_keys::OptionalNonZeroPubkey;
use anchor_spl::token_interface::TokenMetadataUpdateAuthority;
use anchor_spl::{
    token_2022::spl_token_2022::instruction::AuthorityType,
    token_interface::{self, Mint, TokenInterface},
};
use folio_admin::{state::ProgramRegistrar, ID as FOLIO_ADMIN_PROGRAM_ID};
use shared::constants::METADATA_SEEDS;
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
    pub rent: Sysvar<'info, Rent>,
    /// CHECK: Instructions sysvar
    #[account(address = instructions::ID)]
    pub instructions_sysvar: UncheckedAccount<'info>,
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

    /// CHECK: The new folio
    #[account(mut)]
    pub new_folio: UncheckedAccount<'info>,

    #[account(
        seeds = [ACTOR_SEEDS, folio_owner.key().as_ref(), old_folio.key().as_ref()],
        bump = actor.bump,
    )]
    pub actor: Account<'info, Actor>,

    #[account(mut)]
    pub old_folio: AccountLoader<'info, Folio>,

    #[account(mut,
    mint::authority = old_folio,
    mint::freeze_authority = old_folio,
    )]
    pub folio_token_mint: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: it is checked in the cpi to the new folio program
    #[account(mut)]
    pub new_folio_basket: UncheckedAccount<'info>,

    /// CHECK: it is checked in the cpi to the new folio program
    #[account(mut)]
    pub new_actor: UncheckedAccount<'info>,
    // Any remaining accounts that are required in the new folio program
    // When calling `create_folio_from_old_program`

    /*
    Metaplex accounts for metadata
     */
    /// CHECK: Token metadata program
    #[account(address = mpl_token_metadata::ID)]
    pub token_metadata_program: UncheckedAccount<'info>,

    /// CHECK: Metadata account
    #[account(
        mut,
        seeds = [
            METADATA_SEEDS,
            mpl_token_metadata::ID.as_ref(),
            folio_token_mint.key().as_ref()
        ],
        seeds::program = mpl_token_metadata::ID,
        bump
    )]
    pub metadata: UncheckedAccount<'info>,
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
    /// * If `max_allowed_pending_fees` is set to true, the old folio can have pending fees.
    pub fn validate(&self, old_folio: &Folio, max_allowed_pending_fees: u128) -> Result<()> {
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

        let last_folio_poke = old_folio.last_poke;
        let current_timestamp = Clock::get()?.unix_timestamp;

        let account_fee_until = old_folio.get_account_fee_until(current_timestamp)?;
        check_condition!(
            // Last folio poke can only be greater than the account_fee_until, when a new folio was created the same day and the migration is being tried the same day.
            // As on creation, of the folio we want to set last_poke to current time.
            // In all other cases, the last_poke should match the account_fee_until.
            account_fee_until <= last_folio_poke,
            MigrationFailedFolioNotPoked
        );

        // Folio owners can decide, up-to what pending amount they want to loss.
        // As these amounts become unmintable and non-distributable in the new program.
        check_condition!(
            old_folio
                .dao_pending_fee_shares
                .lt(&max_allowed_pending_fees),
            MigrationFailedDaoPendingFeeSharesTooHigh
        );

        check_condition!(
            old_folio
                .fee_recipients_pending_fee_shares
                .lt(&max_allowed_pending_fees),
            MigrationFailedFeeRecipientsPendingFeeSharesTooHigh
        );

        check_condition!(
            old_folio
                .fee_recipients_pending_fee_shares_to_be_minted
                .lt(&max_allowed_pending_fees),
            MigrationFailedFeeRecipientsPendingFeeShareToBeMintedTooHigh
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

        check_condition!(
            self.program_registrar.is_in_registrar(crate::ID),
            ProgramNotInRegistrar
        );

        check_condition!(
            self.new_folio_program.key() != FOLIO_PROGRAM_ID,
            CantMigrateToSameProgram
        );

        Ok(())
    }
}

/// Start Folio Migration. This will be called to initiate the migration process.
/// The start of the migration process will transfer the mint and freeze authority to the new folio.
///
/// # Arguments
/// * `ctx` - The context of the instruction.
/// * `max_allowed_pending_fees` - The max allowed pending fees, the folio owner is willing to loss for the migration. Scaled by D18.
pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, StartFolioMigration<'info>>,
    max_allowed_pending_fees: u128,
) -> Result<()> {
    let old_folio_bump: u8;
    {
        let old_folio = &mut ctx.accounts.old_folio.load_mut()?;

        old_folio_bump = old_folio.bump;

        ctx.accounts.validate(old_folio, max_allowed_pending_fees)?;
    }

    // Transfer the mint and freeze authority to the new folio
    let token_mint_key = ctx.accounts.folio_token_mint.key();

    let folio_signer_seeds = &[FOLIO_SEEDS, token_mint_key.as_ref(), &[old_folio_bump]];
    let folio_signer = &[&folio_signer_seeds[..]];

    if ctx.accounts.token_program.key() == Token::id() {
        // Update Metadata authority to the new folio
        Metaplex::update_metadata_authority(
            &UpdateAuthority {
                metadata: ctx.accounts.metadata.to_account_info(),
                mint: ctx.accounts.folio_token_mint.to_account_info(),
                mint_authority: ctx.accounts.old_folio.to_account_info(),
                payer: ctx.accounts.folio_owner.to_account_info(),
                update_authority: ctx.accounts.old_folio.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                rent: ctx.accounts.rent.to_account_info(),
                token_metadata_program: ctx.accounts.token_metadata_program.to_account_info(),
                sysvar_instructions: ctx.accounts.instructions_sysvar.to_account_info(),
            },
            ctx.accounts.new_folio.key(),
            folio_signer,
        )?;
    } else {
        // The metadata is with token 2022 program
        token_metadata_update_authority(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TokenMetadataUpdateAuthority {
                    token_program_id: ctx.accounts.token_program.to_account_info(),
                    metadata: ctx.accounts.folio_token_mint.to_account_info(),
                    current_authority: ctx.accounts.old_folio.to_account_info(),
                    new_authority: ctx.accounts.new_folio.to_account_info(),
                },
                folio_signer,
            ),
            OptionalNonZeroPubkey(ctx.accounts.new_folio.key()),
        )?;

        // Token 2022, does not allow updates for Metadata pointer authority.
    }

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

    // Update the folio status to migrating
    {
        let old_folio = &mut ctx.accounts.old_folio.load_mut()?;
        old_folio.status = FolioStatus::Migrating as u8;
    }

    NewFolioProgram::create_folio_from_old_program(
        &ctx.accounts.new_folio_program,
        &ctx.accounts.system_program,
        &ctx.accounts.folio_owner,
        &ctx.accounts.old_folio.to_account_info(),
        &ctx.accounts.new_folio,
        &ctx.accounts.new_actor,
        &ctx.accounts.new_folio_basket,
        &ctx.accounts.folio_token_mint.to_account_info(),
        ctx.remaining_accounts,
        folio_signer,
    )?;

    // No need to transfer tokens of the folio token mint, as the folio is minting / burning, never holding them.

    Ok(())
}
