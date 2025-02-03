use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token,
    token_interface::{Mint, TokenAccount, TokenInterface},
};
use shared::constants::{DTF_PROGRAM_SIGNER_SEEDS, FOLIO_BASKET_SEEDS, USER_PENDING_BASKET_SEEDS};
use shared::{
    check_condition,
    constants::{PendingBasketType, PROGRAM_REGISTRAR_SEEDS},
};
use shared::{errors::ErrorCode, structs::FolioStatus};

use crate::state::{Folio, FolioBasket, ProgramRegistrar, UserPendingBasket};

#[derive(Accounts)]
pub struct BurnFolioToken<'info> {
    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,

    #[account(mut)]
    pub user: Signer<'info>,

    #[account()]
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
    Accounts to validate
    */
    #[account(
        seeds = [PROGRAM_REGISTRAR_SEEDS],
        bump = program_registrar.bump
    )]
    pub program_registrar: Box<Account<'info, ProgramRegistrar>>,

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
            Some(vec![FolioStatus::Initialized, FolioStatus::Killed]),
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
    shares: u64,
) -> Result<()> {
    let folio = ctx.accounts.folio.load()?;

    ctx.accounts.validate(&folio)?;

    let remaining_accounts = &ctx.remaining_accounts;

    let folio_key = ctx.accounts.folio.key();
    let token_program_id = ctx.accounts.token_program.key();

    let folio_basket = &mut ctx.accounts.folio_basket.load_mut()?;

    // Reorder the user's token amounts to match the folio's token amounts, for efficiency
    let token_amounts_user = &mut ctx.accounts.user_pending_basket.load_mut()?;
    token_amounts_user.reorder_token_amounts(&folio_basket.token_amounts)?;

    // Validate the user passes as many remaining accounts as the folio has mints (validation on those mints is done later)
    check_condition!(
        folio_basket.get_total_number_of_mints() == remaining_accounts.len() as u8,
        InvalidNumberOfRemainingAccounts
    );

    token_amounts_user.to_assets(
        shares,
        &folio_key,
        &token_program_id,
        folio_basket,
        ctx.accounts.folio_token_mint.supply,
        PendingBasketType::RedeemProcess,
        remaining_accounts,
    )?;

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
