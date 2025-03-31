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

/// Mint folio tokens to a user based on the shares they have.
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
}

impl MintFolioToken<'_> {
    /// Validate the instruction.
    ///
    /// # Checks
    /// * Folio is valid PDA and initialized.
    /// * Folio token mint is the same as the one in the folio.
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
/// Mint folio tokens to a user based on the shares they have. This is the final step of the minting process.
/// This can only be called once atomically, as it will mint the folio token to the user and requires ALL the token balances
/// of the Folio's token accounts to be able to properly calculate the amount of shares the user can have.
///
/// Since the amount of shares to mint is provided by the user, they technically do not need to "mint" the max amount of shares they
/// are allowed to (based on their pending basket). If they don't mint the maximum, the non-used amounts will stay in the user's
/// pending basket.
///
/// # Arguments
/// * `ctx` - The context of the instruction.
/// * `raw_shares` - The amount of shares the user wants to mint (D9).
/// * `min_raw_shares` - The minimum amount of shares the user wants to mint (D9), to provide slippage protection.
pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, MintFolioToken<'info>>,
    raw_shares: u64,
    min_raw_shares: Option<u64>,
) -> Result<()> {
    let folio_bump = {
        let folio = &mut ctx.accounts.folio.load_mut()?;
        ctx.accounts.validate(folio)?;
        folio.bump
    };

    let token_mint_key = ctx.accounts.folio_token_mint.key();
    let current_time = Clock::get()?.unix_timestamp;

    let folio_basket = &mut ctx.accounts.folio_basket.load_mut()?;

    let token_amounts_user = &mut ctx.accounts.user_pending_basket.load_mut()?;

    // Get the related folio fees
    let fee_details = ctx
        .accounts
        .dao_fee_config
        .get_fee_details(&ctx.accounts.folio_fee_config)?;

    {
        let folio = &mut ctx.accounts.folio.load_mut()?;

        // Folio is poked via the to_assets function, so don't need to poke it here
        token_amounts_user.to_assets(
            raw_shares,
            ctx.accounts.folio_token_mint.supply,
            folio_basket,
            folio,
            PendingBasketType::MintProcess,
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

    if let Some(min_raw_shares) = min_raw_shares {
        check_condition!(
            raw_folio_token_amount_to_mint >= min_raw_shares,
            SlippageExceeded
        );
    }

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
