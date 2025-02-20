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
    PendingBasketType, FOLIO_BASKET_SEEDS, FOLIO_FEE_CONFIG_SEEDS, USER_PENDING_BASKET_SEEDS,
};
use shared::errors::ErrorCode;
use shared::{
    check_condition,
    constants::{DAO_FEE_CONFIG_SEEDS, FOLIO_SEEDS},
};

#[derive(Accounts)]
pub struct MintFolioToken<'info> {
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

impl MintFolioToken<'_> {
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

/*

user amount = share * balance folio / total supply
user amount / balance folio * total supply = share
*/
pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, MintFolioToken<'info>>,
    raw_shares: u64,
) -> Result<()> {
    let folio_bump = {
        let folio = &mut ctx.accounts.folio.load_mut()?;
        ctx.accounts.validate(folio)?;
        folio.bump
    };

    let remaining_accounts = &ctx.remaining_accounts;

    let folio_key = ctx.accounts.folio.key();
    let token_mint_key = ctx.accounts.folio_token_mint.key();
    let token_program_id = ctx.accounts.token_program.key();
    let current_time = Clock::get()?.unix_timestamp;

    let folio_basket = &mut ctx.accounts.folio_basket.load_mut()?;

    // Validate the user passes as many remaining accounts as the folio has mints (validation on those mints is done later)
    check_condition!(
        folio_basket.get_total_number_of_mints() == remaining_accounts.len() as u8,
        InvalidNumberOfRemainingAccounts
    );

    // Reorder the user's token amounts to match the folio's token amounts, for efficiency
    let token_amounts_user = &mut ctx.accounts.user_pending_basket.load_mut()?;
    token_amounts_user.reorder_token_amounts(&folio_basket.token_amounts)?;

    // Get the related folio fees
    let fee_details = ctx
        .accounts
        .dao_fee_config
        .get_fee_details(&ctx.accounts.folio_fee_config)?;

    {
        let folio = &mut ctx.accounts.folio.load_mut()?;

        token_amounts_user.to_assets(
            raw_shares,
            ctx.accounts.folio_token_mint.supply,
            &folio_key,
            &token_program_id,
            folio_basket,
            folio,
            PendingBasketType::MintProcess,
            remaining_accounts,
            current_time,
            fee_details.scaled_fee_numerator,
            fee_details.scaled_fee_denominator,
            fee_details.scaled_fee_floor,
        )?;
    }

    // Mint folio token to user based on shares
    let fee_shares = ctx.accounts.folio.load_mut()?.calculate_fees_for_minting(
        raw_shares,
        fee_details.scaled_fee_numerator,
        fee_details.scaled_fee_denominator,
        fee_details.scaled_fee_floor,
    )?;

    let raw_folio_token_amount_to_mint = raw_shares
        .checked_sub(fee_shares.0)
        .ok_or(ErrorCode::MathOverflow)?;

    let signer_seeds = &[FOLIO_SEEDS, token_mint_key.as_ref(), &[folio_bump]];

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
        raw_folio_token_amount_to_mint,
    )?;

    Ok(())
}
