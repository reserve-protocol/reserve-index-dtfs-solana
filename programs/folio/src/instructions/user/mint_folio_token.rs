use std::cmp::max;

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::{get_associated_token_address_with_program_id, AssociatedToken},
    token,
    token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked},
};
use shared::errors::ErrorCode::*;
use shared::{
    check_condition,
    constants::{
        FOLIO_PROGRAM_SIGNER_SEEDS, FOLIO_SEEDS, PENDING_TOKEN_AMOUNTS_SEEDS, PRECISION_FACTOR,
        PROGRAM_REGISTRAR_SEEDS,
    },
    structs::TokenAmount,
};
use shared::{errors::ErrorCode, structs::FolioStatus};

use crate::state::{Folio, FolioProgramSigner, PendingTokenAmounts, ProgramRegistrar};

#[derive(Accounts)]
pub struct MintFolioToken<'info> {
    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,

    #[account(mut)]
    pub user: Signer<'info>,

    #[account(mut)]
    pub folio: AccountLoader<'info, Folio>,

    #[account(mut)]
    pub folio_token_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut,
        seeds = [PENDING_TOKEN_AMOUNTS_SEEDS, folio.key().as_ref()],
        bump
    )]
    pub folio_pending_token_amounts: AccountLoader<'info, PendingTokenAmounts>,

    #[account(mut,
        seeds = [PENDING_TOKEN_AMOUNTS_SEEDS, user.key().as_ref()],
        bump
    )]
    pub user_pending_token_amounts: AccountLoader<'info, PendingTokenAmounts>,

    #[account(mut,
        associated_token::mint = user_folio_token_account.mint,
        associated_token::authority = user,
    )]
    pub user_folio_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    /*
    The remaining accounts need to match the order of amounts as parameter

    Remaining accounts will have as many as possible of the following (always in the same order):
        - Folio Token Account (in same order as pending token amounts)
     */
}

impl<'info> MintFolioToken<'info> {
    pub fn validate(&self, folio: &Folio) -> Result<()> {
        folio.validate_folio_program_post_init(
            &self.folio.key(),
            None,
            None,
            None,
            None,
            None,
            Some(FolioStatus::Initialized),
        )?;

        check_condition!(
            self.folio_token_mint.key() == folio.folio_token_mint,
            InvalidFolioTokenMint
        );

        Ok(())
    }
}

/*
Shares is how much share the user wants, all the pending token amounts need to be AT LEAST valid for the amount of shares the user wants

Shares follows the precision PRECISION_FACTOR
*/
pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, MintFolioToken<'info>>,
    shares: u64,
) -> Result<()> {
    //TODO calculate fee

    let folio = ctx.accounts.folio.load()?;

    ctx.accounts.validate(&folio)?;

    let remaining_accounts = &ctx.remaining_accounts;

    let folio_key = ctx.accounts.folio.key();
    let token_program_id = ctx.accounts.token_program.key();

    let folio_pending_token_amounts = &mut ctx.accounts.folio_pending_token_amounts.load_mut()?;

    // Reorder the user's token amounts to match the folio's token amounts, for efficiency
    let token_amounts_user = &mut ctx.accounts.user_pending_token_amounts.load_mut()?;

    token_amounts_user.reorder_token_amounts(&folio_pending_token_amounts.token_amounts)?;

    for (index, folio_token_account) in remaining_accounts.iter().enumerate() {
        let related_mint = &mut folio_pending_token_amounts.token_amounts[index];

        // Validate the receiver token account is the ATA of the folio
        check_condition!(
            folio_token_account.key()
                == get_associated_token_address_with_program_id(
                    &folio_key,
                    &related_mint.mint,
                    &token_program_id,
                ),
            InvalidReceiverTokenAccount
        );

        // Get user amount (validate mint)
        let user_amount = &mut token_amounts_user.token_amounts[index];

        check_condition!(user_amount.mint == related_mint.mint, MintMismatch);

        // Get token balance for folio
        let data = folio_token_account.try_borrow_data()?;
        let folio_token_account = TokenAccount::try_deserialize(&mut &data[..])?;

        let folio_token_balance = folio_token_account.amount;

        // Calculate if share is respected
        // TODO extract calculation
        check_condition!(
            user_amount
                .amount
                .checked_mul(PRECISION_FACTOR)
                .unwrap()
                .checked_div(folio_token_balance)
                .unwrap()
                >= shares,
            InvalidShareAmountProvided
        );

        let user_amount_taken = user_amount
            .amount
            .checked_div(folio_token_balance)
            .unwrap()
            .checked_mul(shares)
            .unwrap();
        // TODO set as mint decimals

        // Remove from both pending amounts
        user_amount.amount = user_amount.amount.checked_sub(user_amount_taken).unwrap();
        related_mint.amount = related_mint.amount.checked_sub(user_amount_taken).unwrap();
    }

    // Mint folio token to user based on shares
    let token_mint_key = ctx.accounts.folio_token_mint.key();

    let folio_token_amount_to_mint = shares
        //TODO validate how the initial mints occur?
        .checked_mul(PRECISION_FACTOR)
        .unwrap()
        .checked_div(max(ctx.accounts.folio_token_mint.supply, 1))
        .unwrap();

    let signer_seeds = &[FOLIO_SEEDS, token_mint_key.as_ref(), &[folio.bump]];

    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::MintTo {
                mint: ctx.accounts.folio_token_mint.to_account_info(),
                to: ctx.accounts.user_folio_token_account.to_account_info(),
                authority: ctx.accounts.folio.to_account_info(),
            },
            &[signer_seeds],
        ),
        folio_token_amount_to_mint,
    )?;

    Ok(())
}
