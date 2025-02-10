use crate::state::{Folio, FolioBasket, UserPendingBasket};
use crate::utils::account_util::next_account;
use crate::utils::structs::TokenAmount;
use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::get_associated_token_address_with_program_id,
    token_interface::{self, Mint, TokenInterface, TransferChecked},
};
use shared::errors::ErrorCode;
use shared::{
    check_condition,
    constants::{PendingBasketType, FOLIO_BASKET_SEEDS, FOLIO_SEEDS, USER_PENDING_BASKET_SEEDS},
};

#[derive(Accounts)]
pub struct RemoveFromPendingBasket<'info> {
    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,

    #[account(mut)]
    pub user: Signer<'info>,

    #[account()]
    pub folio: AccountLoader<'info, Folio>,

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
    /*
    The remaining accounts need to match the order of amounts as parameter

    Remaining accounts will have as many as possible of the following (always in the same order):
        - Token Mint (read)
        - Sender Token Account (needs to be owned by folio) (mut)
        - Receiver Token Account (needs to be owned by user) (mut)
     */
}

impl RemoveFromPendingBasket<'_> {
    pub fn validate(&self, folio: &Folio) -> Result<()> {
        folio.validate_folio(
            &self.folio.key(),
            None,
            None,
            // User should always be able to take back their pending tokens
            None,
        )?;

        Ok(())
    }
}

pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, RemoveFromPendingBasket<'info>>,
    amounts: Vec<u64>,
) -> Result<()> {
    let folio_info = ctx.accounts.folio.to_account_info();
    let folio = ctx.accounts.folio.load()?;

    ctx.accounts.validate(&folio)?;

    let remaining_accounts = &ctx.remaining_accounts;
    let mut remaining_accounts_iter = remaining_accounts.iter();

    let user_key = ctx.accounts.user.key();
    let token_program_id = ctx.accounts.token_program.key();

    // Remaining accounts need to be divisible by 3
    check_condition!(
        remaining_accounts.len() % 3 == 0,
        InvalidNumberOfRemainingAccounts
    );

    // Remaining accounts divisible by 3 needs to be equal to length of amounts
    check_condition!(
        remaining_accounts.len() / 3 == amounts.len(),
        InvalidNumberOfRemainingAccounts
    );

    let mut removed_mints: Vec<TokenAmount> = vec![];

    for amount in amounts {
        let token_mint = next_account(
            &mut remaining_accounts_iter,
            false,
            false,
            &token_program_id,
        )?;
        let sender_token_account =
            next_account(&mut remaining_accounts_iter, false, true, &token_program_id)?;
        let receiver_token_account =
            next_account(&mut remaining_accounts_iter, false, true, &token_program_id)?;

        // Validate the receiver token account is the ATA of the folio
        check_condition!(
            receiver_token_account.key()
                == get_associated_token_address_with_program_id(
                    &user_key,
                    token_mint.key,
                    &token_program_id,
                ),
            InvalidReceiverTokenAccount
        );

        // Get decimals from token mint
        let data = token_mint.try_borrow_data()?;
        let mint = Mint::try_deserialize(&mut &data[..])?;

        let cpi_accounts = TransferChecked {
            from: sender_token_account.to_account_info(),
            to: receiver_token_account.to_account_info(),
            authority: folio_info.clone(),
            mint: token_mint.to_account_info(),
        };

        let cpi_program = ctx.accounts.token_program.to_account_info();

        let folio_mint_key = folio.folio_token_mint;
        let signer_seeds = &[FOLIO_SEEDS, folio_mint_key.as_ref(), &[folio.bump]];

        token_interface::transfer_checked(
            CpiContext::new_with_signer(cpi_program, cpi_accounts, &[signer_seeds]),
            amount,
            mint.decimals,
        )?;

        removed_mints.push(TokenAmount {
            mint: token_mint.key(),
            amount_for_minting: amount,
            amount_for_redeeming: 0,
        });
    }

    /*
    Don't need to validate mint existence, as the folio might not have this mint anymore, but the user should
    still be able to remove the amount his own pending token amounts
     */
    ctx.accounts
        .folio_basket
        .load_mut()?
        .remove_token_amounts_from_folio(&removed_mints, false, PendingBasketType::MintProcess)?;

    ctx.accounts
        .user_pending_basket
        .load_mut()?
        .remove_token_amounts_from_folio(&removed_mints, true, PendingBasketType::MintProcess)?;

    Ok(())
}
