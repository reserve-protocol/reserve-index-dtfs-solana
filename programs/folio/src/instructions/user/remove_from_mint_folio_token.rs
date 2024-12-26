use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::get_associated_token_address_with_program_id,
    token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked},
};
use shared::errors::ErrorCode::*;
use shared::{
    check_condition,
    constants::{
        FOLIO_PROGRAM_SIGNER_SEEDS, FOLIO_SEEDS, PENDING_TOKEN_AMOUNTS_SEEDS,
        PROGRAM_REGISTRAR_SEEDS,
    },
    structs::TokenAmount,
};
use shared::{errors::ErrorCode, structs::FolioStatus};

use crate::state::{Folio, FolioProgramSigner, PendingTokenAmounts, ProgramRegistrar};

#[derive(Accounts)]
pub struct RemoveFromMintFolioToken<'info> {
    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,

    #[account(mut)]
    pub user: Signer<'info>,

    #[account(mut)]
    pub folio: AccountLoader<'info, Folio>,

    #[account(mut,
        seeds = [PENDING_TOKEN_AMOUNTS_SEEDS, folio.key().as_ref()],
        bump
    )]
    pub folio_pending_token_amounts: AccountLoader<'info, PendingTokenAmounts>,

    #[account(mut,
        seeds = [PENDING_TOKEN_AMOUNTS_SEEDS, user.key().as_ref()],
        bump
    )]
    pub user_pending_token_amounts: AccountLoader<'info, PendingTokenAmounts>,
    /*
    The remaining accounts need to match the order of amounts as parameter

    Remaining accounts will have as many as possible of the following (always in the same order):
        - Token Mint (read)
        - Sender Token Account (needs to be owned by folio) (mut)
        - Receiver Token Account (needs to be owned by user) (mut)
     */
}

impl<'info> RemoveFromMintFolioToken<'info> {
    pub fn validate(&self, folio: &Folio) -> Result<()> {
        folio.validate_folio_program_post_init(
            &self.folio.key(),
            None,
            None,
            None,
            None,
            None,
            Some(FolioStatus::Initialized),
        )?;

        Ok(())
    }
}

pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, RemoveFromMintFolioToken<'info>>,
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
        let token_mint = remaining_accounts_iter
            .next()
            .ok_or(InvalidRemovedTokenMints)?;
        let sender_token_account = remaining_accounts_iter
            .next()
            .ok_or(InvalidRemovedTokenMints)?;
        let receiver_token_account = remaining_accounts_iter
            .next()
            .ok_or(InvalidRemovedTokenMints)?;

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

        match token_interface::transfer_checked(
            CpiContext::new_with_signer(cpi_program, cpi_accounts, &[signer_seeds]),
            amount,
            mint.decimals,
        ) {
            Ok(_) => {
                removed_mints.push(TokenAmount {
                    mint: token_mint.key(),
                    amount,
                });
            }
            Err(e) => {
                // TODO check error type to not rever
                msg!("Error transferring token: {:?}", e);
            }
        }
    }

    /*
    Don't need to validate mint existence, as the folio might not have this mint anymore, but the user should
    still be able to remove the amount his own pending token amounts
     */
    ctx.accounts
        .folio_pending_token_amounts
        .load_mut()?
        .remove_token_amounts_to_folio(&removed_mints, false)?;

    ctx.accounts
        .user_pending_token_amounts
        .load_mut()?
        .remove_token_amounts_to_folio(&removed_mints, true)?;

    Ok(())
}
