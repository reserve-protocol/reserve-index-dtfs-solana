use crate::{
    state::{Folio, FolioBasket},
    utils::{FolioStatus, FolioTokenAmount},
};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount};
use folio_admin::{state::ProgramRegistrar, ID as FOLIO_ADMIN_PROGRAM_ID};
use shared::{
    check_condition,
    constants::{FOLIO_BASKET_SEEDS, PROGRAM_REGISTRAR_SEEDS},
    errors::ErrorCode,
};

/// Mint from this new folio program, called by the old folio program.
///
/// THIS IS ONLY TO SHOW AN EXAMPLE OF WHAT SHOULD BE IMPLEMENTED IN FUTURE VERSIONS
/// OF THE FOLIO PROGRAM. IT WON'T BE INCLUDED IN THE MAINNET BUILD FOR THIS VERSION
/// OF THE FOLIO PROGRAM.
///
/// # Arguments
/// * `old_folio` - The old folio to use
/// * `new_folio` - The new folio to use
/// * `old_folio_basket` - The old folio basket to use
/// * `new_folio_basket` - The new folio basket to use
/// * `token_mint` - The token mint to use
/// * `folio_token_account` - The folio token account to use
#[derive(Accounts)]

pub struct UpdateBasketInNewFolioProgram<'info> {
    /// CHECK: Validate is from the old folio program using the seeds
    /// For now it validates with hardcoded program ids, but this is just because it's for testing only
    /// in this version of the folio program
    #[account()]
    pub old_folio: Signer<'info>,

    /// For now it validates with hardcoded program ids, but this is just because it's for testing only
    /// in this version of the folio program
    #[account(mut)]
    pub new_folio: AccountLoader<'info, Folio>,

    /// CHECK: Seeds are checked and the account data is checked in cpi to new folio program
    #[account(
        seeds = [FOLIO_BASKET_SEEDS, old_folio.key().as_ref()],
        bump,
        seeds::program = old_folio.owner,
        owner = *old_folio.owner,
    )]
    pub old_folio_basket: UncheckedAccount<'info>,

    /// CHECK: Seeds are checked and the account data is checked in cpi to new folio program
    #[account(
        mut,
        seeds = [FOLIO_BASKET_SEEDS, new_folio.key().as_ref()],
        bump,
    )]
    pub new_folio_basket: AccountLoader<'info, FolioBasket>,

    pub token_mint: Box<InterfaceAccount<'info, Mint>>,

    // Expected to be the ATA of the new folio with the token mint that is being migrated.
    #[account(
        associated_token::authority = new_folio,
        associated_token::mint = token_mint,
    )]
    pub folio_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        seeds = [PROGRAM_REGISTRAR_SEEDS],
        bump = program_registrar.bump,
        seeds::program = FOLIO_ADMIN_PROGRAM_ID,
    )]
    pub program_registrar: Box<Account<'info, ProgramRegistrar>>,
}

impl UpdateBasketInNewFolioProgram<'_> {
    /// Validate the instruction.
    pub fn validate(&self, old_folio: &Folio, new_folio: &Folio) -> Result<()> {
        check_condition!(
            old_folio.status == FolioStatus::Migrating as u8,
            InvalidFolioStatus
        );
        check_condition!(
            new_folio.folio_token_mint == old_folio.folio_token_mint,
            InvalidFolioTokenMint
        );

        check_condition!(
            self.program_registrar
                .is_in_registrar(*self.old_folio.owner),
            ProgramNotInRegistrar
        );

        Ok(())
    }
}

/// This is used to update the basket in the new folio program.
///
/// # Arguments
/// * `ctx` - The context of the instruction.
#[allow(unused_variables)]
pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, UpdateBasketInNewFolioProgram<'info>>,
) -> Result<()> {
    // If by mistake it's included in the program, if we don't see dev flag, we return ok
    #[cfg(not(feature = "test"))]
    return Ok(());

    #[allow(unreachable_code)]
    let folio_data = &ctx.accounts.old_folio.data.borrow();
    let old_folio: &Folio = bytemuck::from_bytes(&folio_data[8..]);
    let new_folio = &mut ctx.accounts.new_folio.load_mut()?;

    {
        ctx.accounts.validate(old_folio, new_folio)?;
    }

    let new_folio_basket = &mut ctx.accounts.new_folio_basket.load_mut()?;

    let mint_pk = ctx.accounts.token_mint.key();

    let token_balance_in_old_folio_basket: u64;
    let token_left_in_old_folio_basket_after_removal_of_mint_pk: usize;

    {
        let old_folio_basket_data = &ctx.accounts.old_folio_basket.data.borrow();
        let old_folio_basket: &FolioBasket = bytemuck::from_bytes(&old_folio_basket_data[8..]);

        token_balance_in_old_folio_basket =
            old_folio_basket.get_token_amount_in_folio_basket(&mint_pk)?;

        token_left_in_old_folio_basket_after_removal_of_mint_pk = old_folio_basket
            .basket
            .token_amounts
            .iter()
            .filter(|token_amount| {
                // We already know that the removal from folio-basket happens only after the cpi to new folio program, is made.
                token_amount.mint != Pubkey::default() && token_amount.mint != mint_pk
            })
            .count();
    }

    new_folio_basket.add_tokens_to_basket(&vec![FolioTokenAmount {
        mint: mint_pk,
        amount: token_balance_in_old_folio_basket,
    }])?;

    check_condition!(
        ctx.accounts.folio_token_account.amount >= token_balance_in_old_folio_basket,
        InvalidTokenBalance
    );

    if token_left_in_old_folio_basket_after_removal_of_mint_pk > 0 {
        // We set the status of new Folio to migrating to prevent any minting or redeeming
        new_folio.status = FolioStatus::Migrating as u8;
    } else {
        // If there are no tokens left in the old folio basket, we set the status of new Folio to initialized
        new_folio.status = FolioStatus::Initialized as u8;
    }

    Ok(())
}
