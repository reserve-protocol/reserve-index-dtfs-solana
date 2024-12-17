use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::get_associated_token_address_with_program_id,
    token,
    token_interface::{Mint, TokenAccount, TokenInterface},
};
use shared::errors::ErrorCode;
use shared::{
    check_condition,
    constants::{FOLIO_PROGRAM_SIGNER_SEEDS, FOLIO_SEEDS, PROGRAM_REGISTRAR_SEEDS},
};

use crate::state::{Folio, FolioProgramSigner, ProgramRegistrar};

#[derive(Accounts)]
pub struct MintFolioToken<'info> {
    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,

    #[account(mut)]
    pub user: Signer<'info>,

    #[account(mut,
        seeds = [FOLIO_SEEDS, folio_token_mint.key().as_ref()],
        bump
    )]
    pub folio: AccountLoader<'info, Folio>,

    /// CHECK: would have the list of folio coins
    pub folio_coins: AccountInfo<'info>,

    /// CHECK: would have the list of user coins
    #[account(mut)]
    pub user_coin: AccountInfo<'info>,

    #[account(mut)]
    pub folio_token_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut)]
    pub folio_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut)]
    pub user_folio_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    /*

    */
}

impl<'info> MintFolioToken<'info> {
    pub fn validate(&self) -> Result<()> {
        Ok(())
    }
}

pub fn handler(ctx: Context<MintFolioToken>) -> Result<()> {
    ctx.accounts.validate()?;

    let user_balances = vec![1; ctx.remaining_accounts.len()];

    let folio_key = ctx.accounts.folio.key();
    let token_program_id = ctx.accounts.token_program.key();
    for (i, remaining_coin) in ctx.remaining_accounts.iter().enumerate() {
        let coin = remaining_coin.to_account_info();

        let data = coin.try_borrow_data()?;
        let token_account = TokenAccount::try_deserialize(&mut &data[..])?;

        check_condition!(
            coin.key()
                == get_associated_token_address_with_program_id(
                    &folio_key,
                    &token_account.mint,
                    &token_program_id,
                ),
            InvalidReceiverTokenAccount
        );

        let user_proportion = user_balances[i];
        let _user_amount = user_proportion * token_account.amount;

        // check_condition!(user_amount >= 0, InvalidAccountData);
    }

    let token_mint_key = ctx.accounts.folio_token_mint.key();

    let signer_seeds = &[FOLIO_SEEDS, token_mint_key.as_ref(), &[ctx.bumps.folio]];

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
        1,
    )?;

    Ok(())
}
