use crate::state::{Folio, ProgramRegistrar};
use anchor_lang::prelude::*;
use anchor_spl::associated_token::{
    get_associated_token_address, get_associated_token_address_with_program_id, AssociatedToken,
};
use anchor_spl::token_2022::{self, Token2022, Transfer, TransferChecked};
use anchor_spl::token_interface::{Mint, TokenInterface};
use shared::errors::ErrorCode;
use shared::structs::{FeeRecipient, FolioStatus};
use shared::{
    check_condition,
    constants::{ACTOR_SEEDS, DTF_PROGRAM_SIGNER_SEEDS, FOLIO_SEEDS, PROGRAM_REGISTRAR_SEEDS},
    structs::Role,
};

#[derive(Accounts)]
pub struct InitTokensForFolio<'info> {
    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,

    #[account(mut)]
    pub folio_owner: Signer<'info>,

    /// CHECK: Actor for folio owner
    #[account(mut,
        seeds = [ACTOR_SEEDS, folio_owner.key().as_ref(), folio.key().as_ref()],
        bump,
        seeds::program = dtf_program.key()
    )]
    pub actor: AccountInfo<'info>,

    #[account(
        seeds = [DTF_PROGRAM_SIGNER_SEEDS],
        bump,
        seeds::program = dtf_program.key(),
    )]
    pub dtf_program_signer: Signer<'info>,

    #[account(
        seeds = [PROGRAM_REGISTRAR_SEEDS],
        bump = program_registrar.bump
    )]
    pub program_registrar: Box<Account<'info, ProgramRegistrar>>,

    #[account(
        mut,
        seeds = [FOLIO_SEEDS, folio_token_mint.key().as_ref()],
        bump,
    )]
    pub folio: AccountLoader<'info, Folio>,

    /// CHECK: Folio token mint
    #[account()]
    pub folio_token_mint: AccountInfo<'info>,

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

impl<'info> InitTokensForFolio<'info> {
    pub fn validate(&self, folio_bump: u8) -> Result<()> {
        let folio = self.folio.load()?;
        folio.validate_folio_program_post_init(
            &self.program_registrar,
            &self.dtf_program,
            &self.dtf_program_data,
            Some(folio_bump),
            Some(&self.actor.to_account_info()),
            Some(Role::Owner),
            Some(FolioStatus::Initializing), // Can only add new tokens while it's initializing
        )?;

        Ok(())
    }
}

pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, InitTokensForFolio<'info>>,
    amounts: Vec<u64>,
) -> Result<()> {
    ctx.accounts.validate(ctx.bumps.folio)?;

    let remaining_accounts = &ctx.remaining_accounts;
    let mut remaining_accounts_iter = remaining_accounts.iter();

    let folio_key = ctx.accounts.folio.key();
    let token_program_id = ctx.accounts.token_program.key();
    let folio_owner = ctx.accounts.folio_owner.to_account_info();

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

        token_2022::transfer_checked(
            CpiContext::new(cpi_program, cpi_accounts),
            amount,
            mint.decimals,
        )?;
    }

    Ok(())
}
