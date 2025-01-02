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
    constants::{PENDING_TOKEN_AMOUNTS_SEEDS, PRECISION_FACTOR, PROGRAM_REGISTRAR_SEEDS},
};
use shared::{errors::ErrorCode, structs::FolioStatus};

use crate::state::{Folio, PendingTokenAmounts, ProgramRegistrar};

#[derive(Accounts)]
pub struct BurnFolioToken<'info> {
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
        seeds = [PENDING_TOKEN_AMOUNTS_SEEDS, folio.key().as_ref(), user.key().as_ref()],
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

impl BurnFolioToken<'_> {
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

pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, BurnFolioToken<'info>>,
    amount_to_burn: u64,
) -> Result<()> {
    let folio = ctx.accounts.folio.load()?;

    ctx.accounts.validate(&folio)?;

    let remaining_accounts = &ctx.remaining_accounts;

    let folio_key = ctx.accounts.folio.key();
    let token_program_id = ctx.accounts.token_program.key();

    let folio_pending_token_amounts = &mut ctx.accounts.folio_pending_token_amounts.load_mut()?;

    // Reorder the user's token amounts to match the folio's token amounts, for efficiency
    let token_amounts_user = &mut ctx.accounts.user_pending_token_amounts.load_mut()?;

    token_amounts_user.reorder_token_amounts(&folio_pending_token_amounts.token_amounts)?;

    // Calculate share of the folio the user "owns"
    let shares = (amount_to_burn as u128)
        .checked_mul(PRECISION_FACTOR as u128)
        .unwrap()
        .checked_div(max(ctx.accounts.folio_token_mint.supply, 1) as u128)
        .unwrap() as u64;

    for (index, folio_token_account) in remaining_accounts.iter().enumerate() {
        let related_mint = &mut folio_pending_token_amounts.token_amounts[index];

        // Validate the provided token account is the ATA of the folio (to calculate balances)
        check_condition!(
            folio_token_account.key()
                == get_associated_token_address_with_program_id(
                    &folio_key,
                    &related_mint.mint,
                    &token_program_id,
                ),
            InvalidReceiverTokenAccount
        );

        // Calculate how much the user gets
        let user_amount = &mut token_amounts_user.token_amounts[index];

        check_condition!(user_amount.mint == related_mint.mint, MintMismatch);

        // Get token balance for folio
        let data = folio_token_account.try_borrow_data()?;
        let folio_token_account = TokenAccount::try_deserialize(&mut &data[..])?;

        let folio_token_balance =
            PendingTokenAmounts::get_clean_token_balance(folio_token_account.amount, related_mint);

        let amount_to_give_to_user = (folio_token_balance as u128)
            .checked_mul(shares as u128)
            .unwrap()
            .checked_div(PRECISION_FACTOR as u128)
            .unwrap() as u64;

        // Add to both pending amounts for redeeming
        user_amount.amount_for_redeeming = user_amount
            .amount_for_redeeming
            .checked_add(amount_to_give_to_user)
            .unwrap();
        related_mint.amount_for_redeeming = related_mint
            .amount_for_redeeming
            .checked_add(amount_to_give_to_user)
            .unwrap();
    }

    // Burn folio token from user's folio token account
    token::burn(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            token::Burn {
                mint: ctx.accounts.folio_token_mint.to_account_info(),
                from: ctx.accounts.user_folio_token_account.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        amount_to_burn,
    )?;

    Ok(())
}
