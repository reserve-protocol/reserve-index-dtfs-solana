use crate::state::{Folio, FolioBasket, UserPendingBasket};
use crate::utils::structs::FolioStatus;
use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token,
    token_interface::{Mint, TokenAccount, TokenInterface},
};
use folio_admin::state::DAOFeeConfig;
use folio_admin::ID as FOLIO_ADMIN_PROGRAM_ID;
use shared::constants::{
    DAO_FEE_CONFIG_SEEDS, FOLIO_BASKET_SEEDS, FOLIO_FEE_CONFIG_SEEDS, USER_PENDING_BASKET_SEEDS,
};
use shared::errors::ErrorCode;
use shared::{check_condition, constants::PendingBasketType};

/// Burn folio tokens from a user's folio token account.
///
/// # Arguments
/// * `system_program` - The system program.
/// * `token_program` - The token program.
/// * `associated_token_program` - The associated token program.
/// * `user` - The user account (mut, signer).
/// * `dao_fee_config` - The DAO fee config account (PDA) (not mut, not signer).
/// * `folio_fee_config` - The folio fee config account (PDA) (not mut, not signer).
/// * `folio` - The folio account (PDA) (mut, not signer).
/// * `folio_token_mint` - The folio token mint account (PDA) (mut, not signer).
/// * `folio_basket` - The folio basket account (PDA) (mut, not signer).
/// * `user_pending_basket` - The user pending basket account (PDA) (mut, not signer).
/// * `user_folio_token_account` - The user folio token account (PDA) (mut, not signer).
///
/// * `remaining_accounts` - The remaining accounts will represent the token accounts of the Folio
#[derive(Accounts)]
pub struct BurnFolioToken<'info> {
    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,

    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        seeds = [DAO_FEE_CONFIG_SEEDS],
        bump,
        seeds::program = FOLIO_ADMIN_PROGRAM_ID,
    )]
    pub dao_fee_config: Account<'info, DAOFeeConfig>,

    /// CHECK: Could be empty or could be set, if set we use that one, else we use dao fee config
    #[account(
        seeds = [FOLIO_FEE_CONFIG_SEEDS, folio.key().as_ref()],
        bump,
        seeds::program = FOLIO_ADMIN_PROGRAM_ID,
    )]
    pub folio_fee_config: UncheckedAccount<'info>,

    #[account(mut)]
    pub folio: AccountLoader<'info, Folio>,

    #[account(mut)]
    pub folio_token_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut,
        seeds = [FOLIO_BASKET_SEEDS, folio.key().as_ref()],
        bump
    )]
    pub folio_basket: AccountLoader<'info, FolioBasket>,

    #[account(mut,
        seeds = [USER_PENDING_BASKET_SEEDS, folio.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub user_pending_basket: AccountLoader<'info, UserPendingBasket>,

    #[account(mut,
        associated_token::mint = folio_token_mint,
        associated_token::authority = user,
    )]
    pub user_folio_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    /*
    The remaining accounts need to match the order of amounts as parameter

    Remaining accounts will have as many as possible of the following (always in the same order):
        - Folio Token Account (in same order as pending token amounts)
     */
}

impl BurnFolioToken<'_> {
    /// Validate the instruction.
    ///
    /// # Checks
    /// * Folio is valid PDA and initialized or killed.
    /// * Folio token mint is the same as the one in the folio.
    pub fn validate(&self, folio: &Folio) -> Result<()> {
        folio.validate_folio(
            &self.folio.key(),
            None,
            None,
            Some(vec![FolioStatus::Initialized, FolioStatus::Killed]),
        )?;

        check_condition!(
            self.folio_token_mint.key() == folio.folio_token_mint,
            InvalidFolioTokenMint
        );

        Ok(())
    }
}

/// Burn folio tokens from a user's folio token account. This is the first step of the redeeming process.
/// This can only be called once atomically, as it will burn the folio token from the user's folio token account and requires ALL the token balances
/// of the Folio's token accounts to be able to properly calculate the amount of shares the user can have.
/// This action can't be rolled back.
///
/// # Arguments
/// * `ctx` - The context of the instruction.
/// * `raw_shares` - The amount of shares the user wants to burn (D9).
pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, BurnFolioToken<'info>>,
    raw_shares: u64,
) -> Result<()> {
    let remaining_accounts = &ctx.remaining_accounts;

    let folio_key = ctx.accounts.folio.key();
    let token_program_id = ctx.accounts.token_program.key();
    let current_time = Clock::get()?.unix_timestamp;

    {
        let folio = ctx.accounts.folio.load()?;

        ctx.accounts.validate(&folio)?;

        let folio_basket = &mut ctx.accounts.folio_basket.load_mut()?;

        // Reorder the user's token amounts to match the folio's token amounts, for efficiency
        let token_amounts_user = &mut ctx.accounts.user_pending_basket.load_mut()?;
        token_amounts_user.reorder_token_amounts(&folio_basket.token_amounts)?;

        // Validate the user passes as many remaining accounts as the folio has mints (validation on those mints is done later)
        check_condition!(
            folio_basket.get_total_number_of_mints() == remaining_accounts.len() as u8,
            InvalidNumberOfRemainingAccounts
        );
    }

    // Get the related folio fees
    let fee_details = ctx
        .accounts
        .dao_fee_config
        .get_fee_details(&ctx.accounts.folio_fee_config)?;

    {
        let token_amounts_user = &mut ctx.accounts.user_pending_basket.load_mut()?;
        let folio = &mut ctx.accounts.folio.load_mut()?;
        let folio_basket = &mut ctx.accounts.folio_basket.load_mut()?;

        // Folio is poked via the to_assets function, so don't need to poke it here
        token_amounts_user.to_assets(
            raw_shares,
            ctx.accounts.folio_token_mint.supply,
            &folio_key,
            &token_program_id,
            folio_basket,
            folio,
            PendingBasketType::RedeemProcess,
            remaining_accounts,
            current_time,
            fee_details.scaled_fee_numerator,
            fee_details.scaled_fee_denominator,
            fee_details.scaled_fee_floor,
        )?;
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
        raw_shares,
    )?;

    Ok(())
}
