use std::str::FromStr;

use crate::state::Folio;
use anchor_lang::prelude::*;
use anchor_spl::token;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use shared::check_condition;
use shared::constants::FOLIO_SEEDS;
use shared::errors::ErrorCode;

/// Mint from this new folio program, called by the old folio program.
///
/// THIS IS ONLY TO SHOW AN EXAMPLE OF WHAT SHOULD BE IMPLEMENTED IN FUTURE VERSIONS
/// OF THE FOLIO PROGRAM. IT WON'T BE INCLUDED IN THE MAINNET BUILD FOR THIS VERSION
/// OF THE FOLIO PROGRAM.
///
/// # Arguments
/// * `token_program` - The token program to use
/// * `old_folio` - The old folio to use
/// * `new_folio` - The new folio to use
/// * `folio_token_mint` - The folio token mint to use
/// * `to` - The account to mint the token to
#[derive(Accounts)]
pub struct MintFromNewFolioProgram<'info> {
    pub token_program: Interface<'info, TokenInterface>,

    /// CHECK: Validate is from the old folio program using the seeds
    /// For now it validates with hardcoded program ids, but this is just because it's for testing only
    /// in this version of the folio program
    #[account(
        seeds = [FOLIO_SEEDS, folio_token_mint.key().as_ref()],
        bump,
        seeds::program = Pubkey::from_str("n6sR7Eg5LMg5SGorxK9q3ZePHs9e8gjoQ7TgUW2YCaG").unwrap(),
    )]
    pub old_folio: Signer<'info>,

    /// For now it validates with hardcoded program ids, but this is just because it's for testing only
    /// in this version of the folio program
    #[account(
        seeds = [FOLIO_SEEDS, folio_token_mint.key().as_ref()],
        bump,
        seeds::program = Pubkey::from_str("7ApLyZSzV9jHseZnSLmyHJjsbNWzd85DYx2qe8cSCLWt").unwrap(),
    )]
    pub new_folio: AccountLoader<'info, Folio>,

    #[account(mut)]
    pub folio_token_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut)]
    pub to: Box<InterfaceAccount<'info, TokenAccount>>,
}

impl MintFromNewFolioProgram<'_> {
    /// Validate the instruction.
    ///
    /// # Checks
    /// * Provided folio token mint account is the same as the one on the folio account.
    pub fn validate(&self, folio: &Folio) -> Result<()> {
        check_condition!(
            self.folio_token_mint.key() == folio.folio_token_mint,
            InvalidFolioTokenMint
        );

        Ok(())
    }
}

/// Mint from new folio program.
/// This is used to mint tokens from the new folio program to the to account and is called by the old folio program.
/// This is needed because when a migration starts, the mint authority is transferred to the new folio.
///
/// # Arguments
/// * `ctx` - The context of the instruction.
#[allow(unused_variables)]
pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, MintFromNewFolioProgram<'info>>,
    amount: u64,
) -> Result<()> {
    // If by mistake it's included in the program, if we don't see dev flag, we return ok
    #[cfg(not(feature = "dev"))]
    return Ok(());

    #[allow(unreachable_code)]
    let new_folio_bump: u8;

    let token_mint_key = ctx.accounts.folio_token_mint.key();

    {
        let new_folio = &ctx.accounts.new_folio.load()?;

        new_folio_bump = new_folio.bump;

        ctx.accounts.validate(new_folio)?;
    }

    let signer_seeds = &[FOLIO_SEEDS, token_mint_key.as_ref(), &[new_folio_bump]];

    let cpi_accounts = token::MintTo {
        mint: ctx.accounts.folio_token_mint.to_account_info(),
        to: ctx.accounts.to.to_account_info(),
        authority: ctx.accounts.new_folio.to_account_info(),
    };

    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            &[signer_seeds],
        ),
        amount,
    )?;

    Ok(())
}
