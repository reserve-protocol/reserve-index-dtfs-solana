use crate::state::{Actor, Folio, PendingBasket, ProgramRegistrar};
use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address_with_program_id;
use anchor_spl::token_interface::{self, Mint, TokenInterface, TransferChecked};
use shared::check_condition;
use shared::constants::PENDING_BASKET_SEEDS;
use shared::errors::ErrorCode;
use shared::structs::{FolioStatus, TokenAmount};
use shared::{
    constants::{ACTOR_SEEDS, DTF_PROGRAM_SIGNER_SEEDS, PROGRAM_REGISTRAR_SEEDS},
    structs::Role,
};

#[derive(Accounts)]
pub struct AddToBasket<'info> {
    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,

    #[account(mut)]
    pub folio_owner: Signer<'info>,

    #[account(mut,
        seeds = [ACTOR_SEEDS, folio_owner.key().as_ref(), folio.key().as_ref()],
        bump = actor.bump,
    )]
    pub actor: Account<'info, Actor>,

    #[account(mut)]
    pub folio: AccountLoader<'info, Folio>,

    #[account(init_if_needed,
        payer = folio_owner,
        space = PendingBasket::SIZE,
        seeds = [PENDING_BASKET_SEEDS, folio.key().as_ref()],
        bump
    )]
    pub folio_pending_basket: AccountLoader<'info, PendingBasket>,

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
        - Sender Token Account (needs to be owned by owner) (mut)
        - Receiver Token Account (needs to be owned by folio) (this is expected to be the ATA and already exist, to save on compute) (mut)
     */
}

impl AddToBasket<'_> {
    pub fn validate(&self) -> Result<()> {
        let folio = self.folio.load()?;
        folio.validate_folio_program_post_init(
            &self.folio.key(),
            Some(&self.program_registrar),
            Some(&self.dtf_program),
            Some(&self.dtf_program_data),
            Some(&self.actor),
            Some(Role::Owner),
            Some(FolioStatus::Initializing), // Can only add new tokens while it's initializing
        )?;

        Ok(())
    }
}

pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, AddToBasket<'info>>,
    amounts: Vec<u64>,
) -> Result<()> {
    ctx.accounts.validate()?;

    let remaining_accounts = &ctx.remaining_accounts;
    let mut remaining_accounts_iter = remaining_accounts.iter();

    let folio_key = ctx.accounts.folio.key();
    let token_program_id = ctx.accounts.token_program.key();
    let folio_owner = ctx.accounts.folio_owner.to_account_info();

    let mut added_mints: Vec<TokenAmount> = vec![];

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
        let token_mint = remaining_accounts_iter
            .next()
            .expect("Token mint not found");
        let sender_token_account = remaining_accounts_iter
            .next()
            .expect("Sender token account not found");
        let receiver_token_account = remaining_accounts_iter
            .next()
            .expect("Receiver token account not found");

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
            authority: folio_owner.clone(),
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
            amount_for_minting: 0,
            amount_for_redeeming: 0,
        });
    }

    PendingBasket::process_init_if_needed(
        &mut ctx.accounts.folio_pending_basket,
        ctx.bumps.folio_pending_basket,
        &ctx.accounts.folio.key(),
        &ctx.accounts.folio.key(),
        &added_mints,
        true,
    )?;

    Ok(())
}
