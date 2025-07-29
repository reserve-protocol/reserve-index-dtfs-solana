use crate::{
    state::{Actor, Folio, FolioBasket},
    utils::FolioStatus,
};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;
use shared::{
    check_condition,
    constants::{ACTOR_SEEDS, FOLIO_BASKET_SEEDS, FOLIO_SEEDS},
    errors::ErrorCode,
};

/// Create a new folio from the old folio program. And initializes the FolioBasket account.
///
/// THIS IS ONLY TO SHOW AN EXAMPLE OF WHAT SHOULD BE IMPLEMENTED IN FUTURE VERSIONS
/// OF THE FOLIO PROGRAM. IT WON'T BE INCLUDED IN THE MAINNET BUILD FOR THIS VERSION
/// OF THE FOLIO PROGRAM.
///
/// # Arguments
/// * `system_program` - The system program to use
/// * `new_folio_program` - The new folio program to use
/// * `old_folio` - The old folio to use
/// * `new_folio` - The new folio to use
/// * `actor` - The actor to use
/// * `new_folio_basket` - The new folio basket to use
/// * `folio_token_mint` - The folio token mint to use
#[derive(Accounts)]
pub struct CreateFolioFromOldProgram<'info> {
    pub system_program: Program<'info, System>,
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account()]
    pub old_folio: Signer<'info>,

    #[account(
        init,
        payer = owner,
        space = Folio::SIZE,
        seeds = [FOLIO_SEEDS, folio_token_mint.key().as_ref()],
        bump,
    )]
    pub new_folio: AccountLoader<'info, Folio>,

    #[account(
        init,
        payer = owner,
        space = Actor::SIZE,
        seeds = [ACTOR_SEEDS, owner.key().as_ref(), new_folio.key().as_ref()],
        bump
    )]
    pub actor: Box<Account<'info, Actor>>,

    /// CHECK: Seeds are checked and the account data is checked in cpi to new folio program
    #[account(
        init,
        payer = owner,
        space = FolioBasket::SIZE,
        seeds = [FOLIO_BASKET_SEEDS, new_folio.key().as_ref()],
        bump,
    )]
    pub new_folio_basket: AccountLoader<'info, FolioBasket>,

    pub folio_token_mint: Box<InterfaceAccount<'info, Mint>>,
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
    #[cfg(not(feature = "test"))]
    return Ok(());

    #[allow(unreachable_code)]
    let folio_data = &ctx.accounts.old_folio.data.borrow();
    let old_folio: &Folio = bytemuck::from_bytes(&folio_data[8..]);

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
        folio.initialized_at = old_folio.initialized_at;

        // We can set these to 0, as the old_program, before calling this function confirms us that the
        // values are less then D9, or max the folio owner is willing to loss as fees.
        folio.dao_pending_fee_shares = 0;
        folio.fee_recipients_pending_fee_shares = 0;
        folio.fee_recipients_pending_fee_shares_to_be_minted = 0;

        folio.status = FolioStatus::Migrating as u8;
    }

    FolioBasket::process_init_if_needed(
        &mut ctx.accounts.new_folio_basket,
        ctx.bumps.new_folio_basket,
        &ctx.accounts.new_folio.key(),
        &vec![],
    )?;

    Ok(())
}
