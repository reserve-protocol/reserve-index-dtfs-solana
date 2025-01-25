use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::get_associated_token_address_with_program_id,
    token_interface::{self, Mint, TokenInterface, TransferChecked},
};
use shared::constants::DTF_PROGRAM_SIGNER_SEEDS;
use shared::{
    check_condition,
    constants::{
        PendingBasketType, FOLIO_BASKET_SEEDS, FOLIO_SEEDS, PROGRAM_REGISTRAR_SEEDS,
        USER_PENDING_BASKET_SEEDS,
    },
    structs::TokenAmount,
    util::account_util::next_account,
};
use shared::{errors::ErrorCode, structs::FolioStatus};

use crate::state::{Folio, FolioBasket, ProgramRegistrar, UserPendingBasket};

#[derive(Accounts)]
pub struct RedeemFromPendingBasket<'info> {
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
    pub token_program: Interface<'info, TokenInterface>,

    #[account(mut)]
    pub user: Signer<'info>,

    #[account(mut)]
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
    Accounts to validate
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
        - Sender Token Account (needs to be owned by folio) (mut)
        - Receiver Token Account (needs to be owned by user) (this is expected to be the ATA and already exist, to save on compute) (mut)
     */
}

impl RedeemFromPendingBasket<'_> {
    pub fn validate(&self) -> Result<()> {
        let folio = self.folio.load()?;
        folio.validate_folio_program_post_init(
            &self.folio.key(),
            Some(&self.program_registrar),
            Some(&self.dtf_program),
            Some(&self.dtf_program_data),
            None,
            None,
            Some(vec![FolioStatus::Initialized, FolioStatus::Killed]),
        )?;

        Ok(())
    }
}

pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, RedeemFromPendingBasket<'info>>,
    amounts: Vec<u64>,
) -> Result<()> {
    ctx.accounts.validate()?;

    let remaining_accounts = &ctx.remaining_accounts;
    let mut remaining_accounts_iter = remaining_accounts.iter();

    let token_program_id = ctx.accounts.token_program.key();
    let user = ctx.accounts.user.to_account_info();
    let folio = ctx.accounts.folio.to_account_info();
    let folio_data = ctx.accounts.folio.load()?;

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
        let token_mint = next_account(&mut remaining_accounts_iter, false, false)?;
        let sender_token_account = next_account(&mut remaining_accounts_iter, false, true)?;
        let receiver_token_account = next_account(&mut remaining_accounts_iter, false, true)?;

        // Validate the receiver token account is the ATA of the user
        check_condition!(
            receiver_token_account.key()
                == get_associated_token_address_with_program_id(
                    &user.key(),
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
            authority: folio.clone(),
            mint: token_mint.to_account_info(),
        };

        let cpi_program = ctx.accounts.token_program.to_account_info();

        let signer_seeds = &[
            FOLIO_SEEDS,
            folio_data.folio_token_mint.as_ref(),
            &[folio_data.bump],
        ];

        token_interface::transfer_checked(
            CpiContext::new_with_signer(cpi_program, cpi_accounts, &[&signer_seeds[..]]),
            amount,
            mint.decimals,
        )?;

        removed_mints.push(TokenAmount {
            mint: token_mint.key(),
            amount_for_minting: 0,
            amount_for_redeeming: amount,
        });
    }

    let folio_basket = &mut ctx.accounts.folio_basket.load_mut()?;
    folio_basket.remove_token_amounts_from_folio(
        &removed_mints,
        false,
        PendingBasketType::RedeemProcess,
    )?;

    let user_pending_basket = &mut ctx.accounts.user_pending_basket.load_mut()?;
    user_pending_basket.remove_token_amounts_from_folio(
        &removed_mints,
        true,
        PendingBasketType::RedeemProcess,
    )?;

    Ok(())
}
