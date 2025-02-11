use crate::events::BasketTokenAdded;
use crate::state::{Actor, Folio, FolioBasket};
use crate::utils::account_util::next_account;
use crate::utils::structs::{FolioStatus, Role};
use anchor_lang::prelude::*;
use anchor_spl::associated_token::{get_associated_token_address_with_program_id, AssociatedToken};
use anchor_spl::token;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};
use shared::check_condition;
use shared::constants::{ACTOR_SEEDS, FOLIO_BASKET_SEEDS, FOLIO_SEEDS};
use shared::errors::ErrorCode;

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
    )]
    pub owner_folio_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    /*
    The remaining accounts need to match the order of amounts as parameter
    Remaining accounts will have as many as possible of the following (always in the same order):
        - Token Mint (read)
        - Sender Token Account (needs to be owned by owner) (mut)
        - Recipient Token Account (needs to be owned by folio) (this is expected to be the ATA and already exist, to save on compute) (mut)
     */
}

impl AddToBasket<'_> {
    pub fn validate(&self, folio: &Folio) -> Result<()> {
        folio.validate_folio(
            &self.folio.key(),
            Some(&self.actor),
            Some(Role::Owner),
            Some(vec![FolioStatus::Initializing, FolioStatus::Initialized]),
        )?;

        Ok(())
    }
}

fn mint_initial_shares<'info>(
    ctx: &Context<'_, '_, 'info, 'info, AddToBasket<'info>>,
    initial_shares: Option<u64>,
) -> Result<()> {
    let token_mint_key = ctx.accounts.folio_token_mint.key();

    {
        let folio = ctx.accounts.folio.load()?;

        if folio.status == FolioStatus::Initializing as u8 {
            let bump = folio.bump;
            let signer_seeds = &[FOLIO_SEEDS, token_mint_key.as_ref(), &[bump]];

            let cpi_accounts = token::MintTo {
                mint: ctx.accounts.folio_token_mint.to_account_info(),
                to: ctx.accounts.owner_folio_token_account.to_account_info(),
                authority: ctx.accounts.folio.to_account_info(),
            };

            token::mint_to(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    cpi_accounts,
                    &[signer_seeds],
                ),
                initial_shares.ok_or(ErrorCode::MathOverflow)?,
            )?;
        }
    }

    {
        let mut folio = ctx.accounts.folio.load_mut()?;

        folio.status = FolioStatus::Initialized as u8;
    }

    Ok(())
}

/*
Initial shares should only be non null for  the first time the folio is "finalized", meaning first time the owner
creates the folio and is done adding the initial list of tokens for the folio.
*/
pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, AddToBasket<'info>>,
    amounts: Vec<u64>,
    initial_shares: Option<u64>,
) -> Result<()> {
    {
        let folio = ctx.accounts.folio.load()?;
        ctx.accounts.validate(&folio)?;
    }

    let folio_key = ctx.accounts.folio.key();

    let remaining_accounts = &ctx.remaining_accounts;
    let mut remaining_accounts_iter = remaining_accounts.iter();

    let token_program_id = ctx.accounts.token_program.key();
    let folio_owner = ctx.accounts.folio_owner.to_account_info();

    let mut added_mints: Vec<Pubkey> = vec![];

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

    for amount in amounts {
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
                    &folio_key,
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
            authority: folio_owner.clone(),
            mint: token_mint.to_account_info(),
        };

        let cpi_program = ctx.accounts.token_program.to_account_info();

        token_interface::transfer_checked(
            CpiContext::new(cpi_program, cpi_accounts),
            amount,
            mint.decimals,
        )?;

        added_mints.push(token_mint.key());

        emit!(BasketTokenAdded {
            token: token_mint.key(),
        });
    }

    FolioBasket::process_init_if_needed(
        &mut ctx.accounts.folio_basket,
        ctx.bumps.folio_basket,
        &folio_key,
        &added_mints,
    )?;

    if initial_shares.is_some() {
        mint_initial_shares(&ctx, initial_shares)?;
    }

    Ok(())
}
