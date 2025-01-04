use std::cmp::max;

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::{get_associated_token_address_with_program_id, AssociatedToken},
    token,
    token_interface::{Mint, TokenAccount, TokenInterface},
};
use shared::{
    check_condition,
    constants::{FOLIO_SEEDS, PENDING_BASKET_SEEDS, PRECISION_FACTOR, PROGRAM_REGISTRAR_SEEDS},
};
use shared::{constants::DTF_PROGRAM_SIGNER_SEEDS, util::math_util::SafeArithmetic};
use shared::{errors::ErrorCode, structs::FolioStatus};

use crate::state::{Folio, PendingBasket, ProgramRegistrar};

#[derive(Accounts)]
pub struct MintFolioToken<'info> {
    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,

    #[account(mut)]
    pub user: Signer<'info>,

    #[account(mut)]
    pub folio: AccountLoader<'info, Folio>,

    #[account(mut)]
    pub folio_token_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut,
        seeds = [PENDING_BASKET_SEEDS, folio.key().as_ref()],
        bump
    )]
    pub folio_pending_basket: AccountLoader<'info, PendingBasket>,

    #[account(mut,
        seeds = [PENDING_BASKET_SEEDS, folio.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub user_pending_basket: AccountLoader<'info, PendingBasket>,

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

    // Represents the shares of the folio token the user wants to mint
    shares: u64,
) -> Result<()> {
    //TODO calculate fee

    let folio = ctx.accounts.folio.load()?;

    ctx.accounts.validate(&folio)?;

    let remaining_accounts = &ctx.remaining_accounts;

    let folio_key = ctx.accounts.folio.key();
    let token_program_id = ctx.accounts.token_program.key();

    let folio_pending_basket = &mut ctx.accounts.folio_pending_basket.load_mut()?;

    // Reorder the user's token amounts to match the folio's token amounts, for efficiency
    let token_amounts_user = &mut ctx.accounts.user_pending_basket.load_mut()?;

    token_amounts_user.reorder_token_amounts(&folio_pending_basket.token_amounts)?;

    for (index, folio_token_account) in remaining_accounts.iter().enumerate() {
        let related_mint = &mut folio_pending_basket.token_amounts[index];

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

        let folio_token_balance =
            PendingBasket::get_clean_token_balance(folio_token_account.amount, related_mint);

        /*
        Calculate if share is respected, by making sure the user has enough tokens compared to the folio's balance.

        I.E. user has put 100 tokens in pending, total folio balance is 2 000 tokens, then user can only ask for 5% max of what
        the folio token supply is.

        5% is 100 tokens, 100 is the full amount of tokens the user has, so 50 000 000 shares (since based on 9 precision)

        Needs to be respected for every token in the folio.

        So here user has 100 000 000 000 * 1 000 000 000 / 2 000 000 000 000 = 50 000 000, which is >=
         */

        check_condition!(
            user_amount
                .amount_for_minting
                .mul_div_precision(PRECISION_FACTOR, folio_token_balance)
                >= shares,
            InvalidShareAmountProvided
        );

        /*
        Calculate how many tokens of the user we take, based on the shares the user wants.

        If user want's 5%, so would be 50 000 000 shares as the number, so would take 100 tokens from the user.

        i.e. shares is 50 000 000 * 2000 000 000 000 / 1 000 000 000 = 100,000,000,000 (so 100 tokens with 9 decimals)
         */
        let user_amount_taken = shares.mul_div_precision(folio_token_balance, PRECISION_FACTOR);

        // Remove from both pending amounts
        user_amount.amount_for_minting = user_amount
            .amount_for_minting
            .checked_sub(user_amount_taken)
            .unwrap();
        related_mint.amount_for_minting = related_mint
            .amount_for_minting
            .checked_sub(user_amount_taken)
            .unwrap();
    }

    // Mint folio token to user based on shares
    let token_mint_key = ctx.accounts.folio_token_mint.key();

    /*
    Calculate how many tokens for the user we mint, based on the shares the user wants.

    I.E. user want's 5% of total supply, so would be 50 000 000 shares as the number, so would mint:

    50 000 000 * 2000 000 000 000 / 1 000 000 000 = 100,000,000,000 (so 100 tokens with 9 decimals)
     */
    let folio_token_amount_to_mint = shares.mul_div_precision(
        max(ctx.accounts.folio_token_mint.supply, 1),
        PRECISION_FACTOR,
    );

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
