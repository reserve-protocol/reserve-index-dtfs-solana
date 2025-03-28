use crate::state::{Folio, FolioBasket, UserPendingBasket};
use crate::utils::structs::TokenAmount;
use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::get_associated_token_address_with_program_id,
    token_interface::{self, Mint, TokenInterface, TransferChecked},
};
use shared::errors::ErrorCode;
use shared::utils::account_util::next_account;
use shared::{
    check_condition,
    constants::{PendingBasketType, FOLIO_BASKET_SEEDS, FOLIO_SEEDS, USER_PENDING_BASKET_SEEDS},
};

const EXPECTED_REMAINING_ACCOUNTS_LENGTH: usize = 3;

/// Remove tokens from the user's pending basket.
///
/// # Arguments
/// * `system_program` - The system program.
/// * `token_program` - The token program.
/// * `user` - The user account (mut, signer).
/// * `folio` - The folio account (PDA) (not mut, not signer).
/// * `folio_basket` - The folio basket account (PDA) (mut, not signer).
/// * `user_pending_basket` - The user pending basket account (PDA) (mut, not signer).
///
/// * `remaining_accounts` - The remaining accounts will represent the tokens being removed from the pending basket.
///
/// Order is
///
/// - Token Mint (read)
/// - Sender Token Account (needs to be owned by folio) (mut)
/// - Recipient Token Account (needs to be owned by user) (mut)
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
        - Recipient Token Account (needs to be owned by user) (mut)
     */
}

impl RemoveFromPendingBasket<'_> {
    /// Validate the instruction.
    ///
    /// # Checks
    /// * Folio is valid PDA.
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

/// Remove tokens from the user's pending basket. This is used during the process of minting a folio token. It can be called multiple times and
/// is to "rollback" or take back the tokens that were transferred to the folio but haven't been used to mint the folio token yet.
///
/// # Arguments
/// * `ctx` - The context of the instruction.
/// * `raw_amounts` - The amounts of the tokens to remove from the pending basket, in the same order as the remaining accounts.
pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, RemoveFromPendingBasket<'info>>,
    raw_amounts: Vec<u64>,
) -> Result<()> {
    let folio_info = ctx.accounts.folio.to_account_info();
    let folio = ctx.accounts.folio.load()?;

    ctx.accounts.validate(&folio)?;

    let remaining_accounts = &ctx.remaining_accounts;
    let mut remaining_accounts_iter = remaining_accounts.iter();

    let user_key = ctx.accounts.user.key();
    let token_program_id = ctx.accounts.token_program.key();

    check_condition!(
        remaining_accounts.len() % EXPECTED_REMAINING_ACCOUNTS_LENGTH == 0,
        InvalidNumberOfRemainingAccounts
    );

    check_condition!(
        remaining_accounts.len() / EXPECTED_REMAINING_ACCOUNTS_LENGTH == raw_amounts.len(),
        InvalidNumberOfRemainingAccounts
    );

    let mut removed_mints: Vec<TokenAmount> = vec![];

    for raw_amount in raw_amounts {
        let token_mint = next_account(
            &mut remaining_accounts_iter,
            false,
            false,
            &token_program_id,
        )?;
        let sender_token_account =
            next_account(&mut remaining_accounts_iter, false, true, &token_program_id)?;
        let recipient_token_account =
            next_account(&mut remaining_accounts_iter, false, true, &token_program_id)?;

        // Validate the recipient token account is the ATA of the folio
        check_condition!(
            recipient_token_account.key()
                == get_associated_token_address_with_program_id(
                    &user_key,
                    token_mint.key,
                    &token_program_id,
                ),
            InvalidRecipientTokenAccount
        );

        // Get decimals from token mint
        let data = token_mint.try_borrow_data()?;
        let mint = Mint::try_deserialize(&mut &data[..])?;

        let cpi_accounts = TransferChecked {
            from: sender_token_account.to_account_info(),
            to: recipient_token_account.to_account_info(),
            authority: folio_info.clone(),
            mint: token_mint.to_account_info(),
        };

        let cpi_program = ctx.accounts.token_program.to_account_info();

        let folio_mint_key = folio.folio_token_mint;
        let signer_seeds = &[FOLIO_SEEDS, folio_mint_key.as_ref(), &[folio.bump]];

        token_interface::transfer_checked(
            CpiContext::new_with_signer(cpi_program, cpi_accounts, &[signer_seeds]),
            raw_amount,
            mint.decimals,
        )?;

        removed_mints.push(TokenAmount {
            mint: token_mint.key(),
            amount_for_minting: raw_amount,
            amount_for_redeeming: 0,
        });
    }

    ctx.accounts
        .user_pending_basket
        .load_mut()?
        .remove_token_amounts_from_folio(&removed_mints, true, PendingBasketType::MintProcess)?;

    Ok(())
}
