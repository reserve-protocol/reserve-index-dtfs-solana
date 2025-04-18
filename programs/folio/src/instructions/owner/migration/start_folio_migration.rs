use crate::instructions::distribute_fees;
use crate::state::{FeeDistribution, FeeRecipients};
use crate::ID as FOLIO_PROGRAM_ID;
use crate::ID;
use crate::{
    state::{Actor, Folio},
    utils::{FolioStatus, Role},
};
use anchor_lang::{prelude::*, system_program, Discriminator};
use anchor_spl::{
    token_2022::spl_token_2022::instruction::AuthorityType,
    token_interface::{self, Mint, TokenInterface},
};
use folio_admin::{state::ProgramRegistrar, ID as FOLIO_ADMIN_PROGRAM_ID};
use shared::constants::FEE_DISTRIBUTION_SEEDS;
use shared::errors::ErrorCode;
use shared::utils::init_pda_account_rent;
use shared::{
    check_condition,
    constants::{ACTOR_SEEDS, FOLIO_SEEDS, PROGRAM_REGISTRAR_SEEDS},
};

/// Index of the accounts in the remaining accounts.
enum IndexPerAccount {
    TokenProgram,
    DAOFeeConfig,
    FolioFeeConfig,
    FeeDistribution,
    DAOFeeRecipient,
    FeeRecipients,
}

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
    /*
    Remaining accounts will be just for distributing the fees

    Order is

    - Token program
    - DAO fee config
    - Folio fee config
    - Fee Distribution (mut)
    - DAO fee recipient (mut)
    - Fee Recipients
     */
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
            data.len() >= 8 && data[0..8] == *Folio::DISCRIMINATOR,
            InvalidNewFolio
        );

        Ok(())
    }
}

impl<'info> StartFolioMigration<'info> {
    /// Distribute fees
    ///
    /// # Arguments
    /// * `remaining_accounts` - The remaining accounts contains the extra accounts required to distribute the fees.
    /// * `index_for_fee_distribution` - The index of the next fee distribution account to create.
    pub fn distribute_fees(
        &self,
        remaining_accounts: &'info [AccountInfo<'info>],
        index_for_fee_distribution: u64,
    ) -> Result<()> {
        {
            let folio_status = {
                let folio = self.old_folio.load()?;
                folio.status.into()
            };

            // Don't distribute fees if the isn't INITIALIZED or KILLED
            if ![FolioStatus::Killed, FolioStatus::Initialized].contains(&folio_status) {
                return Ok(());
            }

            let dao_fee_config =
                Account::try_from(&remaining_accounts[IndexPerAccount::DAOFeeConfig as usize])?;

            // Create the fee distribution account (since the distribute fees init it, but we're skipping the anchor's context by
            // calling the function directly)
            let folio_key = self.old_folio.key();
            let index_for_fee_distribution_parsed = index_for_fee_distribution.to_le_bytes();

            let seeds_for_fee_distribution = &[
                FEE_DISTRIBUTION_SEEDS,
                folio_key.as_ref(),
                index_for_fee_distribution_parsed.as_slice(),
            ];

            let (fee_distribution_account, fee_distribution_bump) =
                Pubkey::find_program_address(seeds_for_fee_distribution, &FOLIO_PROGRAM_ID);

            let seeds_with_bump = [
                FEE_DISTRIBUTION_SEEDS,
                folio_key.as_ref(),
                index_for_fee_distribution_parsed.as_slice(),
                &[fee_distribution_bump],
            ];

            check_condition!(
                fee_distribution_account
                    == remaining_accounts[IndexPerAccount::FeeDistribution as usize].key(),
                InvalidFeeDistribution
            );

            init_pda_account_rent(
                &remaining_accounts[IndexPerAccount::FeeDistribution as usize],
                FeeDistribution::SIZE,
                &self.folio_owner,
                &ID,
                &self.system_program,
                &[&seeds_with_bump[..]],
            )?;

            let fee_distribution: AccountLoader<FeeDistribution> =
                AccountLoader::try_from_unchecked(
                    &system_program::ID,
                    &remaining_accounts[IndexPerAccount::FeeDistribution as usize],
                )?;

            let fee_recipients: AccountLoader<FeeRecipients> = AccountLoader::try_from(
                &remaining_accounts[IndexPerAccount::FeeRecipients as usize],
            )?;

            distribute_fees(
                &remaining_accounts[IndexPerAccount::TokenProgram as usize],
                &self.folio_owner,
                &dao_fee_config,
                &remaining_accounts[IndexPerAccount::FolioFeeConfig as usize],
                &self.old_folio,
                &self.folio_token_mint,
                &fee_recipients,
                &fee_distribution,
                &remaining_accounts[IndexPerAccount::DAOFeeRecipient as usize],
                index_for_fee_distribution,
            )?;
        }

        Ok(())
    }
}

/// Start Folio Migration. This will be called to initiate the migration process.
/// The start of the migration process will transfer the mint and freeze authority to the new folio.
///
/// # Arguments
/// * `ctx` - The context of the instruction.
/// * `index_for_fee_distribution` - The index of the next fee distribution account to create.
pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, StartFolioMigration<'info>>,
    index_for_fee_distribution: u64,
) -> Result<()> {
    let old_folio_bump: u8;
    {
        let old_folio = &mut ctx.accounts.old_folio.load_mut()?;

        old_folio_bump = old_folio.bump;

        ctx.accounts.validate(old_folio)?;

        // Update old folio status
        old_folio.status = FolioStatus::Migrating as u8;
    }

    // Distribute the fees
    ctx.accounts
        .distribute_fees(ctx.remaining_accounts, index_for_fee_distribution)?;

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
