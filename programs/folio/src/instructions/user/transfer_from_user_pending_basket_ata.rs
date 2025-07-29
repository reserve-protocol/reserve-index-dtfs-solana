use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, CloseAccount, Mint, TokenAccount, TokenInterface, TransferChecked,
};
use shared::constants::USER_PENDING_BASKET_SEEDS;

use crate::state::{Folio, UserPendingBasket};

/// Transfer tokens from the user's pending basket to the user's token account.
/// Because of the MintFlow, where the swap output is send to the `user_pending_basket_token_account`,
/// We have this instruction if the flow fails and user want to withdraw the tokens.
///
/// # Arguments
/// * `system_program` - The system program.
/// * `rent` - The rent sysvar.
/// * `token_program` - The token program.
/// * `user` - The user account (mut, signer).
/// * `user_pending_basket` - The user pending basket account (PDA) ().
/// * `token_mint` - The token mint account (read).
/// * `user_token_account` - The user token account (mut).
/// * `user_pending_basket_token_account` - The user pending basket token account (mut).
///
#[derive(Accounts)]
pub struct TransferFromUserPendingBasketAta<'info> {
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
    pub token_program: Interface<'info, TokenInterface>,

    #[account(mut)]
    pub user: Signer<'info>,

    #[account()]
    pub folio: AccountLoader<'info, Folio>,

    #[account(
        seeds = [USER_PENDING_BASKET_SEEDS, folio.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub user_pending_basket: AccountLoader<'info, UserPendingBasket>,

    pub token_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut,
        associated_token::mint = token_mint,
        associated_token::authority = user,
        associated_token::token_program = token_program,
    )]
    pub user_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut,
        associated_token::mint = token_mint,
        associated_token::authority = user_pending_basket,
        associated_token::token_program = token_program,
        )]
    pub user_pending_basket_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
}

pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, TransferFromUserPendingBasketAta<'info>>,
) -> Result<()> {
    let cpi_accounts = TransferChecked {
        from: ctx
            .accounts
            .user_pending_basket_token_account
            .to_account_info(),
        to: ctx.accounts.user_token_account.to_account_info(),
        authority: ctx.accounts.user_pending_basket.to_account_info(),
        mint: ctx.accounts.token_mint.to_account_info(),
    };

    let cpi_program = ctx.accounts.token_program.to_account_info();

    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            cpi_program,
            cpi_accounts,
            &[&[
                USER_PENDING_BASKET_SEEDS,
                ctx.accounts.folio.key().as_ref(),
                ctx.accounts.user.key().as_ref(),
                &[ctx.bumps.user_pending_basket],
            ]],
        ),
        ctx.accounts.user_pending_basket_token_account.amount,
        ctx.accounts.token_mint.decimals,
    )?;

    // Closes the user_pending_basket_token_account and transfers rent sol to user.
    token_interface::close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        CloseAccount {
            account: ctx
                .accounts
                .user_pending_basket_token_account
                .to_account_info(),
            destination: ctx.accounts.user.to_account_info(),
            authority: ctx.accounts.user_pending_basket.to_account_info(),
        },
        &[&[
            USER_PENDING_BASKET_SEEDS,
            ctx.accounts.folio.key().as_ref(),
            ctx.accounts.user.key().as_ref(),
            &[ctx.bumps.user_pending_basket],
        ]],
    ))?;

    Ok(())
}
