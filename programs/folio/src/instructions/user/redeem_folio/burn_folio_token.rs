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
    DAO_FEE_CONFIG_SEEDS, FEE_DENOMINATOR, FOLIO_BASKET_SEEDS, USER_PENDING_BASKET_SEEDS,
};
use shared::errors::ErrorCode;
use shared::{check_condition, constants::PendingBasketType};

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
    pub fn validate(&self, folio: &Folio) -> Result<()> {
        folio.validate_folio(
            &self.folio.key(),
            None,
            None,
            Some(vec![FolioStatus::Initialized]),
        )?;

        check_condition!(
            self.folio_token_mint.key() == folio.folio_token_mint,
            InvalidFolioTokenMint
        );

        Ok(())
    }
}

/// This function is used when the user wants to burn his folio token shares and withdraw the underlying tokens.
///
/// shares: u64: is in token amount, which we consider D9
pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, BurnFolioToken<'info>>,
    shares: u64,
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
    let dao_fee_numerator = ctx.accounts.dao_fee_config.fee_recipient_numerator;
    let dao_fee_denominator = FEE_DENOMINATOR;
    let dao_fee_floor = ctx.accounts.dao_fee_config.fee_floor;
    {
        let token_amounts_user = &mut ctx.accounts.user_pending_basket.load_mut()?;
        let folio = &mut ctx.accounts.folio.load_mut()?;
        let folio_basket = &mut ctx.accounts.folio_basket.load_mut()?;

        token_amounts_user.to_assets(
            shares,
            ctx.accounts.folio_token_mint.supply,
            &folio_key,
            &token_program_id,
            folio_basket,
            folio,
            PendingBasketType::RedeemProcess,
            remaining_accounts,
            current_time,
            dao_fee_numerator,
            dao_fee_denominator,
            dao_fee_floor,
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
        shares,
    )?;

    Ok(())
}
