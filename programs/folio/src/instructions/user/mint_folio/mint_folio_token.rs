use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token,
    token_interface::{Mint, TokenAccount, TokenInterface},
};
use shared::{
    check_condition,
    constants::{
        PendingBasketType, DAO_FEE_CONFIG_SEEDS, FOLIO_SEEDS, PENDING_BASKET_SEEDS,
        PROGRAM_REGISTRAR_SEEDS,
    },
    structs::DecimalValue,
};
use shared::{constants::DTF_PROGRAM_SIGNER_SEEDS, structs::Rounding};
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

    /// CHECK: DAO fee config to get fee for minting
    #[account(
        seeds = [DAO_FEE_CONFIG_SEEDS],
        bump,
        seeds::program = dtf_program.key(),
    )]
    pub dao_fee_config: UncheckedAccount<'info>,
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

user amount = share * balance folio / total supply
user amount / balance folio * total supply = share
*/
pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, MintFolioToken<'info>>,
    shares: DecimalValue,
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

    let folio_pending_basket = &mut ctx.accounts.folio_pending_basket.load_mut()?;

    // Reorder the user's token amounts to match the folio's token amounts, for efficiency
    let token_amounts_user = &mut ctx.accounts.user_pending_basket.load_mut()?;
    token_amounts_user.reorder_token_amounts(&folio_pending_basket.token_amounts)?;

    let decimal_total_supply_folio_token = DecimalValue::from_token_amount(
        ctx.accounts.folio_token_mint.supply,
        ctx.accounts.folio_token_mint.decimals,
    );

    token_amounts_user.to_assets(
        shares,
        &folio_key,
        &token_program_id,
        folio_pending_basket,
        &decimal_total_supply_folio_token,
        PendingBasketType::MintProcess,
        remaining_accounts,
    )?;

    // Mint folio token to user based on shares
    // TODO put back in next commit
    // let fee_shares =
    //     folio.calculate_fees_for_minting(shares, &ctx.accounts.dao_fee_config.to_account_info())?;
    let fee_shares = DecimalValue::ZERO;

    let folio_token_amount_to_mint = shares
        .sub(&fee_shares)
        .unwrap()
        .to_token_amount(ctx.accounts.folio_token_mint.decimals, Rounding::Ceil);

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
        folio_token_amount_to_mint,
    )?;

    Ok(())
}
