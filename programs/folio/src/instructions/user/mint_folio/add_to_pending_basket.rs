use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::get_associated_token_address_with_program_id,
    token_interface::{self, Mint, TokenInterface, TransferChecked},
};
use shared::{
    check_condition,
    constants::{PendingBasketType, PENDING_BASKET_SEEDS, PROGRAM_REGISTRAR_SEEDS},
    structs::TokenAmount,
};
use shared::{constants::DTF_PROGRAM_SIGNER_SEEDS, errors::ErrorCode::*};
use shared::{errors::ErrorCode, structs::FolioStatus};

use crate::state::{Folio, PendingBasket, ProgramRegistrar};

#[derive(Accounts)]
pub struct AddToPendingBasket<'info> {
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
    pub token_program: Interface<'info, TokenInterface>,

    #[account(mut)]
    pub user: Signer<'info>,

    #[account(mut)]
    pub folio: AccountLoader<'info, Folio>,

    #[account(mut,
        seeds = [PENDING_BASKET_SEEDS, folio.key().as_ref()],
        bump
    )]
    pub folio_pending_basket: AccountLoader<'info, PendingBasket>,

    #[account(init_if_needed,
        payer = user,
        space = PendingBasket::SIZE,
        seeds = [PENDING_BASKET_SEEDS, folio.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub user_pending_basket: AccountLoader<'info, PendingBasket>,

    /*
    Account to validate
    */
    #[account(
        seeds = [PROGRAM_REGISTRAR_SEEDS],
        bump = program_registrar.bump
    )]
    pub program_registrar: Box<Account<'info, ProgramRegistrar>>,

    #[account(
        seeds = [DTF_PROGRAM_SIGNER_SEEDS],
        bump,
        seeds::program = dtf_program.key(),
    )]
    pub dtf_program_signer: Signer<'info>,

    /// CHECK: DTF program used for creating owner record
    #[account()]
    pub dtf_program: UncheckedAccount<'info>,

    /// CHECK: DTF program data to validate program deployment slot
    #[account()]
    pub dtf_program_data: UncheckedAccount<'info>,
    /*
    The remaining accounts need to match the order of amounts as parameter

    Remaining accounts will have as many as possible of the following (always in the same order):
        - Token Mint (read)
        - Sender Token Account (needs to be owned by user) (mut)
        - Receiver Token Account (needs to be owned by folio) (this is expected to be the ATA and already exist, to save on compute) (mut)
     */
}

impl AddToPendingBasket<'_> {
    pub fn validate(&self) -> Result<()> {
        let folio = self.folio.load()?;
        folio.validate_folio_program_post_init(
            &self.folio.key(),
            Some(&self.program_registrar),
            Some(&self.dtf_program),
            Some(&self.dtf_program_data),
            None,
            None,
            Some(FolioStatus::Initialized),
        )?;

        Ok(())
    }
}

pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, AddToPendingBasket<'info>>,
    amounts: Vec<u64>,
) -> Result<()> {
    ctx.accounts.validate()?;

    let remaining_accounts = &ctx.remaining_accounts;
    let mut remaining_accounts_iter = remaining_accounts.iter();

    let folio_key = ctx.accounts.folio.key();
    let token_program_id = ctx.accounts.token_program.key();
    let user = ctx.accounts.user.to_account_info();

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

    let mut added_mints: Vec<TokenAmount> = vec![];

    for amount in amounts {
        let token_mint = remaining_accounts_iter
            .next()
            .ok_or(InvalidAddedTokenMints)?;
        let sender_token_account = remaining_accounts_iter
            .next()
            .ok_or(InvalidAddedTokenMints)?;
        let receiver_token_account = remaining_accounts_iter
            .next()
            .ok_or(InvalidAddedTokenMints)?;

        // Validate the receiver token account is the ATA of the folio
        check_condition!(
            receiver_token_account.key()
                == get_associated_token_address_with_program_id(
                    &folio_key,
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
            authority: user.clone(),
            mint: token_mint.to_account_info(),
        };

        let cpi_program = ctx.accounts.token_program.to_account_info();

        token_interface::transfer_checked(
            CpiContext::new(cpi_program, cpi_accounts),
            amount,
            mint.decimals,
        )?;

        added_mints.push(TokenAmount {
            mint: token_mint.key(),
            amount_for_minting: amount,
            amount_for_redeeming: 0,
        });
    }

    // Can't add new mints if it's for the folio, user should only be able to add what's in the folio's pending token amounts
    let folio_pending_basket = &mut ctx.accounts.folio_pending_basket.load_mut()?;
    folio_pending_basket.add_token_amounts_to_folio(
        &added_mints,
        false,
        PendingBasketType::MintProcess,
    )?;

    PendingBasket::process_init_if_needed(
        &mut ctx.accounts.user_pending_basket,
        ctx.bumps.user_pending_basket,
        &ctx.accounts.user.key(),
        &ctx.accounts.folio.key(),
        &added_mints,
        true,
    )?;

    Ok(())
}
