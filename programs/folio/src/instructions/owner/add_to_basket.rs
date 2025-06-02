use crate::events::BasketTokenAdded;
use crate::state::{Actor, Folio, FolioBasket};
use crate::utils::structs::{FolioStatus, Role};
use crate::utils::FolioTokenAmount;
use anchor_lang::prelude::*;
use anchor_spl::associated_token::{get_associated_token_address_with_program_id, AssociatedToken};
use anchor_spl::token_2022;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};
use shared::check_condition;
use shared::constants::{ACTOR_SEEDS, FOLIO_BASKET_SEEDS, FOLIO_SEEDS};
use shared::errors::ErrorCode;
use shared::utils::account_util::next_account;
use shared::utils::{next_token_program, TokenUtil};

const EXPECTED_REMAINING_ACCOUNTS_LENGTH: usize = 4;

/// Add a token to the folio's basket.
///
/// # Arguments
/// * `system_program` - The system program.
/// * `token_program` - The token program, This is the owner for
/// * `associated_token_program` - The associated token program.
/// * `folio_owner` - The folio owner account (mut, signer).
/// * `actor` - The actor account (PDA) of the Folio owner (mut, not signer).
/// * `folio` - The folio account (PDA) (mut, not signer).
/// * `folio_basket` - The folio basket account (PDA) (init, not signer).
/// * `folio_token_mint` - The folio token mint account (mut, not signer).
/// * `owner_folio_token_account` - The owner's folio token account (mut, not signer).
///
/// * `remaining_accounts` - The remaining accounts will be the token accounts of the tokens to add to the basket.
///         - token program
///         - Token Mint
///         - Sender Token Account (needs to be owned by owner) (mut)
///         - Recipient Token Account (needs to be owned by folio) (this is expected to be the ATA and already exist, to save on compute) (mut)
#[derive(Accounts)]
pub struct AddToBasket<'info> {
    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,

    #[account(mut)]
    pub folio_owner: Signer<'info>,

    #[account(
        seeds = [ACTOR_SEEDS, folio_owner.key().as_ref(), folio.key().as_ref()],
        bump = actor.bump,
    )]
    pub actor: Account<'info, Actor>,

    #[account(mut)]
    pub folio: AccountLoader<'info, Folio>,

    #[account(init_if_needed,
        payer = folio_owner,
        space = FolioBasket::SIZE,
        seeds = [FOLIO_BASKET_SEEDS, folio.key().as_ref()],
        bump
    )]
    pub folio_basket: AccountLoader<'info, FolioBasket>,

    #[account(mut)]
    pub folio_token_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut,
        associated_token::mint = folio_token_mint,
        associated_token::authority = folio_owner,
        associated_token::token_program = folio_token_mint.to_account_info().owner,
    )]
    pub owner_folio_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    /*
    The remaining accounts need to match the order of amounts as parameter
    Remaining accounts will have as many as possible of the following (always in the same order):
        - Token Program (read)
        - Token Mint (read)
        - Sender Token Account (needs to be owned by owner) (mut)
        - Recipient Token Account (needs to be owned by folio) (this is expected to be the ATA and already exist, to save on compute) (mut)
     */
}

impl AddToBasket<'_> {
    /// Validate the instruction.
    ///
    /// # Checks
    /// * Folio has the correct status.
    /// * Actor is the owner of the folio.
    pub fn validate(&self, folio: &Folio, raw_initial_shares: Option<u64>) -> Result<()> {
        folio.validate_folio(
            &self.folio.key(),
            Some(&self.actor),
            Some(vec![Role::Owner]),
            Some(vec![FolioStatus::Initializing, FolioStatus::Initialized]),
        )?;

        if raw_initial_shares.is_some() {
            check_condition!(
                *self.folio_token_mint.to_account_info().owner == self.token_program.key(),
                InvalidTokenMintProgram
            );
        }

        Ok(())
    }
}

/// Mint Initial Shares. Used to mint the initial shares to the owner when the folio is created.
///
/// # Arguments
/// * `ctx` - The context of the instruction.
/// * `raw_initial_shares` - The initial shares to mint (D9).
fn mint_initial_shares<'info>(
    ctx: &Context<'_, '_, 'info, 'info, AddToBasket<'info>>,
    raw_initial_shares: Option<u64>,
) -> Result<()> {
    let token_mint_key = ctx.accounts.folio_token_mint.key();

    {
        let folio = ctx.accounts.folio.load()?;

        // Can only mint the initial shares once
        if folio.status == FolioStatus::Initializing as u8 {
            let bump = folio.bump;
            let signer_seeds = &[FOLIO_SEEDS, token_mint_key.as_ref(), &[bump]];

            let cpi_accounts = token_2022::MintTo {
                mint: ctx.accounts.folio_token_mint.to_account_info(),
                to: ctx.accounts.owner_folio_token_account.to_account_info(),
                authority: ctx.accounts.folio.to_account_info(),
            };

            let token_program = ctx.accounts.token_program.to_account_info();

            token_interface::mint_to(
                CpiContext::new_with_signer(token_program, cpi_accounts, &[signer_seeds]),
                raw_initial_shares.ok_or(ErrorCode::MathOverflow)?,
            )?;
        }
    }

    {
        let mut folio = ctx.accounts.folio.load_mut()?;

        folio.status = FolioStatus::Initialized as u8;
    }

    Ok(())
}

/// Add tokens to the folio's basket, but also mint initial shares if needed.
/// Initial shares should only be non null for  the first time the folio is "finalized", meaning first time the owner
/// creates the folio and is done adding the initial list of tokens for the folio.
///
/// # Arguments
/// * `ctx` - The context of the instruction.
/// * `raw_amounts` - The amounts of the tokens to add to the basket from the Folio's owner folio token account.
/// * `raw_initial_shares` - The initial shares to mint (D9).
pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, AddToBasket<'info>>,
    raw_amounts: Vec<u64>,
    raw_initial_shares: Option<u64>,
) -> Result<()> {
    {
        let folio = ctx.accounts.folio.load()?;
        ctx.accounts.validate(&folio, raw_initial_shares)?;
    }

    let folio_key = ctx.accounts.folio.key();

    let remaining_accounts = &ctx.remaining_accounts;
    let mut remaining_accounts_iter = remaining_accounts.iter();

    let folio_owner = ctx.accounts.folio_owner.to_account_info();

    let mut folio_token_amounts: Vec<FolioTokenAmount> = vec![];

    check_condition!(
        remaining_accounts.len() % EXPECTED_REMAINING_ACCOUNTS_LENGTH == 0,
        InvalidNumberOfRemainingAccounts
    );

    check_condition!(
        remaining_accounts.len() / EXPECTED_REMAINING_ACCOUNTS_LENGTH == raw_amounts.len(),
        InvalidNumberOfRemainingAccounts
    );

    for raw_amount in raw_amounts {
        let token_program = next_token_program(&mut remaining_accounts_iter)?;
        let token_mint = next_account(
            &mut remaining_accounts_iter,
            false,
            false,
            &token_program.key(),
        )?;
        let sender_token_account = next_account(
            &mut remaining_accounts_iter,
            false,
            true,
            &token_program.key(),
        )?;
        let recipient_token_account = next_account(
            &mut remaining_accounts_iter,
            false,
            true,
            &token_program.key(),
        )?;

        // Validate the recipient token account is the ATA of the folio
        check_condition!(
            recipient_token_account.key()
                == get_associated_token_address_with_program_id(
                    &folio_key,
                    token_mint.key,
                    &token_program.key(),
                ),
            InvalidRecipientTokenAccount
        );

        // Validate that the token mint is a supported SPL token
        check_condition!(
            TokenUtil::is_supported_spl_token(
                Some(&token_mint.to_account_info()),
                Some(&sender_token_account.to_account_info())
            )?,
            UnsupportedSPLToken
        );

        // Get decimals from token mint
        let data = token_mint.try_borrow_data()?;
        let mint = Mint::try_deserialize(&mut &data[..])?;

        let cpi_accounts = TransferChecked {
            from: sender_token_account.to_account_info(),
            to: recipient_token_account.to_account_info(),
            authority: folio_owner.clone(),
            mint: token_mint.to_account_info(),
        };

        token_interface::transfer_checked(
            CpiContext::new(token_program.to_account_info(), cpi_accounts),
            raw_amount,
            mint.decimals,
        )?;

        folio_token_amounts.push(FolioTokenAmount {
            mint: token_mint.key(),
            amount: raw_amount,
        });

        emit!(BasketTokenAdded {
            token: token_mint.key(),
        });
    }

    FolioBasket::process_init_if_needed(
        &mut ctx.accounts.folio_basket,
        ctx.bumps.folio_basket,
        &folio_key,
        &folio_token_amounts,
    )?;

    if raw_initial_shares.is_some() {
        mint_initial_shares(&ctx, raw_initial_shares)?;
    }

    Ok(())
}
