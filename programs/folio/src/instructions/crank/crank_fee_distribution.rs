use crate::utils::account_util::next_account;
use crate::utils::structs::FolioStatus;
use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address_with_program_id;
use anchor_spl::token;
use anchor_spl::token_interface::{Mint, TokenInterface};
use shared::check_condition;
use shared::constants::{FEE_DISTRIBUTION_SEEDS, FOLIO_SEEDS, MAX_FEE_RECIPIENTS_PORTION};
use shared::errors::ErrorCode;

use crate::events::FolioFeePaid;
use crate::program::Folio as FolioProgram;
use crate::state::{FeeDistribution, Folio};

#[derive(Accounts)]

pub struct CrankFeeDistribution<'info> {
    pub rent: Sysvar<'info, Rent>,
    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,

    #[account(mut)]
    pub user: Signer<'info>,

    /*
    Specific for the instruction
     */
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
    pub fn validate(&self, folio: &Folio, fee_distribution: &FeeDistribution) -> Result<()> {
        folio.validate_folio(
            &self.folio.key(),
            None,
            None,
            Some(vec![FolioStatus::Initialized]),
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

pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, CrankFeeDistribution<'info>>,
    indices: Vec<u64>,
) -> Result<()> {
    let folio_bump: u8;
    let total_amount_to_distribute: u64;

    let token_mint_key = ctx.accounts.folio_token_mint.key();

    {
        let folio = &ctx.accounts.folio.load()?;
        let fee_distribution = &ctx.accounts.fee_distribution.load()?;

        folio_bump = folio.bump;
        total_amount_to_distribute = fee_distribution.amount_to_distribute;

        ctx.accounts.validate(folio, fee_distribution)?;
    }

    let signer_seeds = &[FOLIO_SEEDS, token_mint_key.as_ref(), &[folio_bump]];

    let remaining_accounts = &ctx.remaining_accounts;
    let mut remaining_accounts_iter = remaining_accounts.iter();
    {
        let fee_distribution = &mut ctx.accounts.fee_distribution.load_mut()?;
        for index in indices {
            let fee_recipient = next_account(&mut remaining_accounts_iter, false, true)?;

            let related_fee_distribution =
                &mut fee_distribution.fee_recipients_state[index as usize];

            // Already distributed (set as default pubkey when distributed)
            if related_fee_distribution.receiver.key() == Pubkey::default() {
                continue;
            }

            // Validate proper token account
            check_condition!(
                fee_recipient.key()
                    == get_associated_token_address_with_program_id(
                        &related_fee_distribution.receiver.key(),
                        &ctx.accounts.folio_token_mint.key(),
                        &ctx.accounts.token_program.key(),
                    ),
                InvalidFeeRecipient
            );

            related_fee_distribution.receiver = Pubkey::default();

            let amount_to_distribute = total_amount_to_distribute
                .checked_mul(related_fee_distribution.portion)
                .ok_or(ErrorCode::MathOverflow)?
                .checked_div(MAX_FEE_RECIPIENTS_PORTION)
                .ok_or(ErrorCode::MathOverflow)?;

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
                    amount_to_distribute,
                )?;

                emit!(FolioFeePaid {
                    recipient: related_fee_distribution.receiver.key(),
                    amount: amount_to_distribute,
                });
            }
        }
    }

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
