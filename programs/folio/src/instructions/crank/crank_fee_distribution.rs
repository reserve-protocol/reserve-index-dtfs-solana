use crate::utils::structs::FolioStatus;
use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address_with_program_id;
use anchor_spl::token;
use anchor_spl::token_interface::{Mint, TokenInterface};
use shared::check_condition;
use shared::constants::{FEE_DISTRIBUTION_SEEDS, FOLIO_SEEDS, MAX_FEE_RECIPIENTS_PORTION};
use shared::errors::ErrorCode;
use shared::utils::account_util::next_account;
use shared::utils::{Decimal, Rounding};

use crate::events::TVLFeePaid;
use crate::program::Folio as FolioProgram;
use crate::state::{FeeDistribution, Folio};

/// Crank Fee Distribution
///
/// # Arguments
/// * `system_program` - The system program.
/// * `token_program` - The token program.
/// * `user` - The user account (mut, signer).
/// * `cranker` - The cranker account (mut, not signer). Used to track who to reimburse the rent to when closing the fee distribution account.
/// * `folio` - The folio account (PDA) (not mut, not signer).
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

    #[account()]
    pub folio: AccountLoader<'info, Folio>,

    #[account(mut)]
    pub folio_token_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut)]
    pub fee_distribution: AccountLoader<'info, FeeDistribution>,
    /*
    Remaining accounts will be the token accounts of the fee recipients, needs to follow the
    order of the indices passed as parameters.
     */
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
                    &FolioProgram::id()
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

    let token_mint_key = ctx.accounts.folio_token_mint.key();

    {
        let folio = &ctx.accounts.folio.load()?;
        let fee_distribution = &ctx.accounts.fee_distribution.load()?;

        folio_bump = folio.bump;
        scaled_total_amount_to_distribute = fee_distribution.amount_to_distribute;

        ctx.accounts.validate(folio, fee_distribution)?;
    }

    let signer_seeds = &[FOLIO_SEEDS, token_mint_key.as_ref(), &[folio_bump]];

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

            {
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

    Ok(())
}
