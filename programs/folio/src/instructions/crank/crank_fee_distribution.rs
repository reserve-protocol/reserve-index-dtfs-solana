use crate::events::TVLFeePaid;
use crate::state::{FeeDistribution, Folio};
use crate::utils::structs::FolioStatus;
use crate::utils::NewFolioProgram;
use crate::ID as FOLIO_PROGRAM_ID;
use anchor_lang::{prelude::*, Discriminator};
use anchor_spl::associated_token::get_associated_token_address_with_program_id;
use anchor_spl::token;
use anchor_spl::token_interface::{Mint, TokenInterface};
use folio_admin::state::ProgramRegistrar;
use folio_admin::ID as FOLIO_ADMIN_PROGRAM_ID;
use shared::check_condition;
use shared::constants::{
    FEE_DISTRIBUTION_SEEDS, FOLIO_SEEDS, MAX_FEE_RECIPIENTS_PORTION, PROGRAM_REGISTRAR_SEEDS,
};
use shared::errors::ErrorCode;
use shared::utils::account_util::next_account;
use shared::utils::{Decimal, Rounding};

/// Crank Fee Distribution
///
/// # Arguments
/// * `system_program` - The system program.
/// * `token_program` - The token program.
/// * `user` - The user account (mut, signer).
/// * `cranker` - The cranker account (mut, not signer). Used to track who to reimburse the rent to when closing the fee distribution account.
/// * `folio` - The folio account (PDA) (mut, not signer).
/// * `folio_token_mint` - The folio token mint account (mut, not signer).
/// * `fee_distribution` - The fee distribution account (PDA) (mut, not signer).
/// * `fee_distribution_token_mint` - The fee distribution token mint account (not mut, not signer).
///
/// * `remaining_accounts` - The remaining accounts will be the token accounts of the fee recipients, needs to follow the
///                          order of the indices passed as parameters.
#[derive(Accounts)]

pub struct CrankFeeDistribution<'info> {
    pub rent: Sysvar<'info, Rent>,
    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,

    #[account(mut)]
    pub user: Signer<'info>,

    /// CHECK: Cranker account
    #[account(mut)]
    pub cranker: UncheckedAccount<'info>,

    #[account(mut)]
    pub folio: AccountLoader<'info, Folio>,

    #[account(mut)]
    pub folio_token_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut)]
    pub fee_distribution: AccountLoader<'info, FeeDistribution>,
    /*
    Remaining accounts will be the token accounts of the fee recipients, needs to follow the
    order of the indices passed as parameters.
     */

    /*
    These acconts are only required if the folio is in a migrating state
     */
    /// CHECK: since the migration process changes the mint authority, we need to accept a potentially different folio account
    /// that would represent the folio but in the upgraded state
    #[account()]
    pub upgraded_folio: Option<UncheckedAccount<'info>>,

    #[account(
        seeds = [PROGRAM_REGISTRAR_SEEDS],
        bump = program_registrar.bump,
        seeds::program = FOLIO_ADMIN_PROGRAM_ID,
    )]
    pub program_registrar: Option<Box<Account<'info, ProgramRegistrar>>>,

    /// CHECK: Folio program used for new folio
    #[account(executable)]
    pub upgraded_folio_program: Option<UncheckedAccount<'info>>,
}

impl CrankFeeDistribution<'_> {
    /// Validate the instruction.
    ///
    /// # Checks
    /// * Folio has the correct status.
    /// * Fee distribution is valid PDA.
    /// * Provided folio token mint account is the same as the one on the folio account.
    /// * Cranker account is the same as the one on the fee distribution account.
    pub fn validate(&self, folio: &Folio, fee_distribution: &FeeDistribution) -> Result<()> {
        folio.validate_folio(
            &self.folio.key(),
            None,
            None,
            // Still want the user to be able to distribute the fees even if folio is migrating or killed
            Some(vec![
                FolioStatus::Initialized,
                FolioStatus::Migrating,
                FolioStatus::Killed,
            ]),
        )?;

        // Validate fee distribution
        check_condition!(
            self.fee_distribution.key()
                == Pubkey::find_program_address(
                    &[
                        FEE_DISTRIBUTION_SEEDS,
                        self.folio.key().as_ref(),
                        fee_distribution.index.to_le_bytes().as_slice()
                    ],
                    &crate::id()
                )
                .0,
            InvalidFeeDistribution
        );

        check_condition!(
            self.folio_token_mint.key() == folio.folio_token_mint,
            InvalidFolioTokenMint
        );

        check_condition!(
            self.cranker.key() == fee_distribution.cranker,
            InvalidCranker
        );

        // If upgraded folio is present, check that it's valid
        if let (Some(upgraded_folio), Some(upgraded_folio_program), Some(program_registrar)) = (
            &self.upgraded_folio,
            &self.upgraded_folio_program,
            &self.program_registrar,
        ) {
            check_condition!(
                folio.status == FolioStatus::Migrating as u8,
                InvalidFolioStatus
            );

            self.validate_if_upgraded_folio(
                upgraded_folio,
                upgraded_folio_program,
                program_registrar,
            )?;
        }

        Ok(())
    }

    pub fn validate_if_upgraded_folio(
        &self,
        upgraded_folio: &UncheckedAccount,
        upgraded_folio_program: &UncheckedAccount,
        program_registrar: &Account<'_, ProgramRegistrar>,
    ) -> Result<()> {
        // Validate that the upgraded folio is the mint authority of the folio token mint
        let mint_authority = self
            .folio_token_mint
            .mint_authority
            .ok_or(ErrorCode::InvalidFolioTokenMint)?;

        check_condition!(
            mint_authority == upgraded_folio.key(),
            InvalidFolioTokenMint
        );

        // Make sure the new folio program is in the registrar
        check_condition!(
            program_registrar.is_in_registrar(upgraded_folio_program.key()),
            ProgramNotInRegistrar
        );

        // Make sure the new folio is owned by the new folio program
        check_condition!(
            *upgraded_folio.owner == upgraded_folio_program.key(),
            NewFolioNotOwnedByNewFolioProgram
        );

        check_condition!(
            upgraded_folio_program.key() != FOLIO_PROGRAM_ID,
            CantMigrateToSameProgram
        );

        // Make sure the discriminator of the new folio is correct
        let data = upgraded_folio.try_borrow_data()?;
        check_condition!(
            data.len() >= 8 && data[0..8] == Folio::discriminator(),
            InvalidNewFolio
        );

        Ok(())
    }
}

/// Crank Fee Distribution.
/// This is used to distribute the fees to the fee recipients in multiple transactions. Since there can be a max of 64 fee recipients,
/// this couldn't fit in only one transaction (size and CUs limits). Therefore, this permissionless instruction is used to distribute the fees in multiple transactions.
/// When all fees are distributed, the fee distribution account is closed and the cranker is reimbursed for the rent, so that people are inclined to
/// call the distribute fees instruction even if there is a rent cost.
///
/// # Arguments
/// * `ctx` - The context of the instruction.
/// * `indices` - The indices of the fee recipients to distribute to.
pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, CrankFeeDistribution<'info>>,
    indices: Vec<u64>,
) -> Result<()> {
    let folio_bump: u8;
    let scaled_total_amount_to_distribute: u128;

    let mut is_migrating = false;

    let token_mint_key = ctx.accounts.folio_token_mint.key();

    {
        let folio = &ctx.accounts.folio.load()?;

        if folio.status == FolioStatus::Migrating as u8 {
            is_migrating = true;
        }

        let fee_distribution = &ctx.accounts.fee_distribution.load()?;

        folio_bump = folio.bump;
        scaled_total_amount_to_distribute = fee_distribution.amount_to_distribute;

        ctx.accounts.validate(folio, fee_distribution)?;
    }

    let signer_seeds = &[FOLIO_SEEDS, token_mint_key.as_ref(), &[folio_bump]];

    let mut amount_to_remove_from_folio_pending_fees: u128 = 0;

    let remaining_accounts = &ctx.remaining_accounts;
    let mut remaining_accounts_iter = remaining_accounts.iter();
    {
        let fee_distribution = &mut ctx.accounts.fee_distribution.load_mut()?;
        for index in indices {
            let fee_recipient = next_account(
                &mut remaining_accounts_iter,
                false,
                true,
                ctx.accounts.token_program.key,
            )?;

            let related_fee_distribution =
                &mut fee_distribution.fee_recipients_state[index as usize];

            // Already distributed (set as default pubkey when distributed)
            if related_fee_distribution.recipient.key() == Pubkey::default() {
                continue;
            }

            // Validate proper token account for the recipient
            check_condition!(
                fee_recipient.key()
                    == get_associated_token_address_with_program_id(
                        &related_fee_distribution.recipient.key(),
                        &ctx.accounts.folio_token_mint.key(),
                        &ctx.accounts.token_program.key(),
                    ),
                InvalidFeeRecipient
            );

            // Set as distributed
            related_fee_distribution.recipient = Pubkey::default();

            let raw_amount_to_distribute = Decimal::from_scaled(scaled_total_amount_to_distribute)
                .mul(&Decimal::from_scaled(related_fee_distribution.portion))?
                .div(&Decimal::from_scaled(MAX_FEE_RECIPIENTS_PORTION))?
                .to_token_amount(Rounding::Floor)?
                .0;

            // This is the case if the folio isn't in a migrated state
            {
                if !is_migrating {
                    let cpi_accounts = token::MintTo {
                        mint: ctx.accounts.folio_token_mint.to_account_info(),
                        to: fee_recipient.to_account_info(),
                        authority: ctx.accounts.folio.to_account_info(),
                    };

                    token::mint_to(
                        CpiContext::new_with_signer(
                            ctx.accounts.token_program.to_account_info(),
                            cpi_accounts,
                            &[signer_seeds],
                        ),
                        raw_amount_to_distribute,
                    )?;
                } else {
                    // Folio is migrating, we need to CPI into the new folio program
                    if let (Some(upgraded_folio_program), Some(upgraded_folio)) = (
                        &ctx.accounts.upgraded_folio_program,
                        &ctx.accounts.upgraded_folio,
                    ) {
                        let upgraded_program_info = upgraded_folio_program.to_account_info();
                        let token_program_info = ctx.accounts.token_program.to_account_info();
                        let folio_info = ctx.accounts.folio.to_account_info();
                        let upgraded_folio_info = upgraded_folio.to_account_info();
                        let token_mint_info = ctx.accounts.folio_token_mint.to_account_info();
                        let fee_recipient_info = fee_recipient.to_account_info();

                        NewFolioProgram::mint_from_new_folio_program(
                            &upgraded_program_info,
                            &token_program_info,
                            &folio_info,
                            &upgraded_folio_info,
                            &token_mint_info,
                            &fee_recipient_info,
                            &[signer_seeds],
                            raw_amount_to_distribute,
                        )?;
                    } else {
                        return Err(error!(ErrorCode::InvalidNewFolio));
                    }
                }

                amount_to_remove_from_folio_pending_fees = amount_to_remove_from_folio_pending_fees
                    .checked_add(raw_amount_to_distribute as u128)
                    .ok_or(ErrorCode::MathOverflow)?;

                emit!(TVLFeePaid {
                    recipient: related_fee_distribution.recipient.key(),
                    amount: raw_amount_to_distribute,
                });
            }
        }
    }

    // Check if we can close the fee distribution account to reimburse the cranker for the rent
    let mut can_close = false;
    {
        let fee_distribution = &ctx.accounts.fee_distribution.load()?;
        if fee_distribution.is_fully_distributed() {
            can_close = true;
        }
    }

    if can_close {
        ctx.accounts
            .fee_distribution
            .close(ctx.accounts.cranker.to_account_info())?;
    }

    let folio = &mut ctx.accounts.folio.load_mut()?;
    folio.fee_recipients_pending_fee_shares_to_be_minted = folio
        .fee_recipients_pending_fee_shares_to_be_minted
        .checked_sub(amount_to_remove_from_folio_pending_fees)
        .ok_or(ErrorCode::MathOverflow)?;

    Ok(())
}
