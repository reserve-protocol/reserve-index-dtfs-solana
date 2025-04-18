use crate::ID as FOLIO_PROGRAM_ID;
use crate::{
    state::{Folio, FolioBasket},
    utils::FolioStatus,
};
use anchor_lang::{prelude::*, Discriminator};
use anchor_spl::associated_token::get_associated_token_address_with_program_id;
use anchor_spl::token_interface;
use anchor_spl::token_interface::{Mint, TokenInterface, TransferChecked};
use folio_admin::{state::ProgramRegistrar, ID as FOLIO_ADMIN_PROGRAM_ID};
use shared::errors::ErrorCode;
use shared::utils::account_util::next_account;
use shared::{
    check_condition,
    constants::{FOLIO_BASKET_SEEDS, FOLIO_SEEDS, PROGRAM_REGISTRAR_SEEDS},
};

const REMAINING_ACCOUT_DIVIDER: usize = 3;

/// Migrate Folio Tokens
/// Permissionless
///
/// # Arguments
/// * `system_program` - The system program.
/// * `token_program` - The token program.
/// * `user` - The user account (mut, signer).
/// * `program_registrar` - The program registrar account (not mut, not signer).
/// * `new_folio_program` - The new folio program (executable).
/// * `old_folio` - The old folio account (PDA) (not mut, not signer).
/// * `old_folio_basket` - The old folio basket account (PDA) (mut, not signer).
/// * `new_folio` - The new folio account (mut, not signer).
/// * `folio_token_mint` - The folio token mint account (mut, not signer).
///
/// * `remaining_accounts` - The remaining accounts will be the token accounts of the folio that are being transferred from the old folio to the new one.
///         - Token Mint
///         - Sender Token Account (needs to be owned by old folio) (mut)
///         - Recipient Token Account (needs to be owned by new folio) (mut)
#[derive(Accounts)]
pub struct MigrateFolioTokens<'info> {
    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,

    // Is permissionless, so folio isn't blocked by folio owner.
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        seeds = [PROGRAM_REGISTRAR_SEEDS],
        bump = program_registrar.bump,
        seeds::program = FOLIO_ADMIN_PROGRAM_ID,
    )]
    pub program_registrar: Box<Account<'info, ProgramRegistrar>>,

    /// CHECK: Folio program used for new folio
    #[account(executable)]
    pub new_folio_program: UncheckedAccount<'info>,

    #[account()]
    pub old_folio: AccountLoader<'info, Folio>,

    #[account(mut,
        seeds = [FOLIO_BASKET_SEEDS, old_folio.key().as_ref()],
        bump
    )]
    pub old_folio_basket: AccountLoader<'info, FolioBasket>,

    /// CHECK: The new folio
    #[account()]
    pub new_folio: UncheckedAccount<'info>,

    // Validate mint is now owned by the new folio
    #[account(
        mint::authority = new_folio,
        mint::freeze_authority = new_folio,
    )]
    pub folio_token_mint: Box<InterfaceAccount<'info, Mint>>,
    /*
    The remaining accounts will represent the folio tokens (in the folio basket)
    Remaining accounts will have as many as possible of the following (always in the same order):
        - Token Mint (read)
        - Sender Token Account (needs to be owned by old folio) (mut)
        - Recipient Token Account (needs to be owned by new folio) (this is expected to be the ATA and already exist, to save on compute) (mut)
     */
}

impl MigrateFolioTokens<'_> {
    /// Validate the instruction.
    ///
    /// # Checks
    /// * Old folio has the correct status.
    /// * Token mint is the same as the one on the old folio.
    /// * New folio program is in the registrar.
    /// * New folio is owned by the new folio program.
    /// * New folio program is not the same as the old folio program.
    pub fn validate(&self, old_folio: &Folio) -> Result<()> {
        // Validate old folio
        old_folio.validate_folio(
            &self.old_folio.key(),
            None,
            None,
            Some(vec![FolioStatus::Migrating]),
        )?;

        check_condition!(
            old_folio.folio_token_mint == self.folio_token_mint.key(),
            InvalidFolioTokenMint
        );

        /*
        New Folio Validation
         */
        // Make sure the new folio program is in the registrar
        check_condition!(
            self.program_registrar
                .is_in_registrar(self.new_folio_program.key()),
            ProgramNotInRegistrar
        );

        // Make sure the new folio is owned by the new folio program
        check_condition!(
            *self.new_folio.owner == self.new_folio_program.key(),
            NewFolioNotOwnedByNewFolioProgram
        );

        check_condition!(
            self.new_folio_program.key() != FOLIO_PROGRAM_ID,
            CantMigrateToSameProgram
        );

        // Make sure the discriminator of the new folio is correct
        let data = self.new_folio.try_borrow_data()?;
        check_condition!(
            data.len() >= 8 && data[0..8] == *Folio::DISCRIMINATOR,
            InvalidNewFolio
        );

        Ok(())
    }
}

/// Migrate Folio Tokens. This will be called once the migration has been initiated by the Folio owner.
///
/// # Arguments
/// * `ctx` - The context of the instruction.
pub fn handler<'info>(ctx: Context<'_, '_, 'info, 'info, MigrateFolioTokens<'info>>) -> Result<()> {
    let old_folio_key = ctx.accounts.old_folio.key();
    let new_folio_key = ctx.accounts.new_folio.key();
    let old_folio_basket = &mut ctx.accounts.old_folio_basket.load_mut()?;
    let token_program_id = ctx.accounts.token_program.key();

    let old_folio_token_mint: Pubkey;
    let old_folio_bump: u8;

    {
        let old_folio = &ctx.accounts.old_folio.load()?;

        old_folio_token_mint = old_folio.folio_token_mint;
        old_folio_bump = old_folio.bump;

        ctx.accounts.validate(old_folio)?;
    }

    let folio_signer_seeds = &[
        FOLIO_SEEDS,
        old_folio_token_mint.as_ref(),
        &[old_folio_bump],
    ];
    let folio_signer = &[&folio_signer_seeds[..]];

    /*
    Transfer the folio tokens (from the folio basket), won't transfer the pending amounts, as those users
    will be able to take them back, on the old folio program, rather than the new one for simplicity and security.
    */
    check_condition!(
        ctx.remaining_accounts.len() % REMAINING_ACCOUT_DIVIDER == 0,
        InvalidNumberOfRemainingAccounts
    );

    let mut remaining_accounts_iter = ctx.remaining_accounts.iter();

    for _ in 0..ctx.remaining_accounts.len() / REMAINING_ACCOUT_DIVIDER {
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

        // Validate the sender token account is the ATA of the old folio
        check_condition!(
            sender_token_account.key()
                == get_associated_token_address_with_program_id(
                    &old_folio_key,
                    token_mint.key,
                    &token_program_id,
                ),
            InvalidSenderTokenAccount
        );

        // Validate the recipient token account is the ATA of the new folio
        check_condition!(
            recipient_token_account.key()
                == get_associated_token_address_with_program_id(
                    &new_folio_key,
                    token_mint.key,
                    &token_program_id,
                ),
            InvalidRecipientTokenAccount
        );

        let mint_decimals = {
            let data = token_mint.try_borrow_data()?;
            Mint::try_deserialize(&mut &data[..])?.decimals
        };

        let raw_migrate_balance =
            old_folio_basket.get_token_amount_in_folio_basket(token_mint.key)?;

        let cpi_accounts = TransferChecked {
            from: sender_token_account.to_account_info(),
            to: recipient_token_account.to_account_info(),
            authority: ctx.accounts.old_folio.to_account_info(),
            mint: token_mint.to_account_info(),
        };

        let cpi_program = ctx.accounts.token_program.to_account_info();

        token_interface::transfer_checked(
            CpiContext::new_with_signer(cpi_program, cpi_accounts, folio_signer),
            raw_migrate_balance,
            mint_decimals,
        )?;

        // Remove the token from the old folio basket
        old_folio_basket.remove_token_mint_from_basket(token_mint.key())?;
    }

    Ok(())
}
