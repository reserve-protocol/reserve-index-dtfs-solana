use crate::{
    state::{Folio, FolioBasket},
    utils::FolioStatus,
};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;
use folio_admin::{state::ProgramRegistrar, ID as FOLIO_ADMIN_PROGRAM_ID};
use shared::{
    check_condition,
    constants::{FOLIO_BASKET_SEEDS, FOLIO_SEEDS, PROGRAM_REGISTRAR_SEEDS},
    errors::ErrorCode,
};

/// Create a new folio from the old folio program. And initializes the FolioBasket account.
///
/// THIS IS ONLY TO SHOW AN EXAMPLE OF WHAT SHOULD BE IMPLEMENTED IN FUTURE VERSIONS
/// OF THE FOLIO PROGRAM. IT WON'T BE INCLUDED IN THE MAINNET BUILD FOR THIS VERSION
/// OF THE FOLIO PROGRAM.
///
/// # Arguments
/// * `old_folio` - The old folio to use
/// * `new_folio` - The new folio to use
/// * `old_folio_basket` - The old folio basket to use
/// * `new_folio_basket` - The new folio basket to use
/// * `token_mint` - The token mint to use
/// * `folio_token_account` - The folio token account to use
#[derive(Accounts)]

pub struct CreateFolioFromOldProgram<'info> {
    pub system_program: Program<'info, System>,
    #[account(mut)]
    pub owner: Signer<'info>,

    /// CHECK: Validate is from the old folio program using the seeds
    /// For now it validates with hardcoded program ids, but this is just because it's for testing only
    /// in this version of the folio program
    #[account(
        owner = old_folio_program.key(),
    )]
    pub old_folio: UncheckedAccount<'info>,

    /// For now it validates with hardcoded program ids, but this is just because it's for testing only
    /// in this version of the folio program
    #[account(
        init,
        payer = owner,
        space = Folio::INIT_SPACE,
        seeds = [FOLIO_SEEDS, folio_token_mint.key().as_ref()],
        bump,
    )]
    pub new_folio: AccountLoader<'info, Folio>,

    /// CHECK: Seeds are checked and the account data is checked in cpi to new folio program
    #[account(
        init,
        payer = owner,
        space = FolioBasket::INIT_SPACE,
        seeds = [FOLIO_BASKET_SEEDS, new_folio.key().as_ref()],
        bump,
    )]
    pub new_folio_basket: AccountLoader<'info, FolioBasket>,

    pub folio_token_mint: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: The account is later checked in the validate function
    #[account(executable)]
    pub old_folio_program: UncheckedAccount<'info>,

    #[account(
        seeds = [PROGRAM_REGISTRAR_SEEDS],
        bump = program_registrar.bump,
        seeds::program = FOLIO_ADMIN_PROGRAM_ID,
    )]
    pub program_registrar: Box<Account<'info, ProgramRegistrar>>,
}

impl CreateFolioFromOldProgram<'_> {
    /// Validate the instruction.
    pub fn validate(&self, old_folio: &Folio) -> Result<()> {
        check_condition!(
            old_folio.status == FolioStatus::Migrating as u8,
            InvalidFolioStatus
        );

        check_condition!(
            self.folio_token_mint.key() == old_folio.folio_token_mint,
            InvalidFolioTokenMint
        );

        check_condition!(
            self.program_registrar
                .is_in_registrar(*self.old_folio.owner),
            ProgramNotInRegistrar
        );

        check_condition!(
            self.program_registrar.is_in_registrar(crate::ID),
            ProgramNotInRegistrar
        );

        Ok(())
    }
}

/// This is used to create a new folio from the old folio program.
///
/// # Arguments
/// * `ctx` - The context of the instruction.
#[allow(unused_variables)]
pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, CreateFolioFromOldProgram<'info>>,
) -> Result<()> {
    // If by mistake it's included in the program, if we don't see dev flag, we return ok
    #[cfg(not(feature = "dev"))]
    return Ok(());

    #[allow(unreachable_code)]
    let folio_data = &ctx.accounts.old_folio.data.borrow();
    let old_folio: &Folio = bytemuck::from_bytes(&folio_data[8..]);
    let new_folio = &mut ctx.accounts.new_folio.load_mut()?;

    {
        ctx.accounts.validate(old_folio)?;
    }

    {
        let folio = &mut ctx.accounts.new_folio.load_init()?;

        folio.bump = ctx.bumps.new_folio;
        folio.folio_token_mint = ctx.accounts.folio_token_mint.key();
        folio.set_tvl_fee(old_folio.tvl_fee)?;
        folio.mint_fee = old_folio.mint_fee;
        folio.last_poke = old_folio.last_poke;
        folio.auction_length = old_folio.auction_length;
        folio.mandate = old_folio.mandate;

        // We set all these to 0
        // Before the migration, In the `start_folio_migration` instruction, we distribute the folio_fee
        // TODO: See how to correct do this : (
        folio.dao_pending_fee_shares = 0;
        folio.fee_recipients_pending_fee_shares = 0;
        folio.fee_recipients_pending_fee_shares_to_be_minted = 0;

        folio.status = FolioStatus::Migrating as u8;
    }

    let new_folio_basket = &mut ctx.accounts.new_folio_basket.load_init()?;

    FolioBasket::process_init_if_needed(
        &mut ctx.accounts.new_folio_basket,
        ctx.bumps.new_folio_basket,
        &ctx.accounts.new_folio.key(),
        &vec![],
    )?;

    Ok(())
}
