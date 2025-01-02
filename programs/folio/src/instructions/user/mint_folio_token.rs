use std::cmp::max;

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::{get_associated_token_address_with_program_id, AssociatedToken},
    token,
    token_interface::{Mint, TokenAccount, TokenInterface},
};
use shared::constants::DTF_PROGRAM_SIGNER_SEEDS;
use shared::{
    check_condition,
    constants::{
        FOLIO_SEEDS, IS_ADDING_TO_MINT_FOLIO, PENDING_TOKEN_AMOUNTS_SEEDS, PRECISION_FACTOR,
        PROGRAM_REGISTRAR_SEEDS,
    },
};
use shared::{errors::ErrorCode, structs::FolioStatus};

use crate::state::{Folio, PendingTokenAmounts, ProgramRegistrar};

#[derive(Accounts)]
pub struct MintFolioToken<'info> {
    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,

    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        seeds = [PROGRAM_REGISTRAR_SEEDS],
        bump = program_registrar.bump
    )]
    pub program_registrar: Box<Account<'info, ProgramRegistrar>>,

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
        seeds = [PENDING_TOKEN_AMOUNTS_SEEDS, folio.key().as_ref(), user.key().as_ref(), &[IS_ADDING_TO_MINT_FOLIO]],
        bump
    )]
    pub user_pending_token_amounts: AccountLoader<'info, PendingTokenAmounts>,

    #[account(mut,
        associated_token::mint = folio_token_mint,
        associated_token::authority = user,
    )]
    pub user_folio_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: DTF program used for creating owner record
    #[account()]
    pub dtf_program: UncheckedAccount<'info>,

    /// CHECK: DTF program data to validate program deployment slot
    #[account()]
    pub dtf_program_data: UncheckedAccount<'info>,

    #[account(
        seeds = [DTF_PROGRAM_SIGNER_SEEDS],
        bump,
        seeds::program = dtf_program.key(),
    )]
    pub dtf_program_signer: Signer<'info>,
    /*
    The remaining accounts need to match the order of amounts as parameter

    Remaining accounts will have as many as possible of the following (always in the same order):
        - Folio Token Account (in same order as pending token amounts)
     */
}

impl MintFolioToken<'_> {
    pub fn validate(&self, folio: &Folio) -> Result<()> {
        folio.validate_folio_program_post_init(
            &self.folio.key(),
            Some(&self.program_registrar),
            Some(&self.dtf_program),
            Some(&self.dtf_program_data),
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
        check_condition!(
            (user_amount.amount as u128)
                .checked_mul(PRECISION_FACTOR as u128)
                .unwrap()
                .checked_div(folio_token_balance as u128)
                .unwrap() as u64
                >= shares,
            InvalidShareAmountProvided
        );

        let user_amount_taken = (user_amount.amount as u128)
            .checked_mul(shares as u128)
            .unwrap()
            .checked_div(PRECISION_FACTOR as u128)
            .unwrap() as u64;
        // Remove from both pending amounts
        user_amount.amount = user_amount.amount.checked_sub(user_amount_taken).unwrap();
        related_mint.amount = related_mint.amount.checked_sub(user_amount_taken).unwrap();
    }

    // Mint folio token to user based on shares
    let token_mint_key = ctx.accounts.folio_token_mint.key();

    let folio_token_amount_to_mint = (shares as u128)
        .checked_mul(max(ctx.accounts.folio_token_mint.supply, 1) as u128)
        .unwrap()
        .checked_div(PRECISION_FACTOR as u128)
        .unwrap() as u64;

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
