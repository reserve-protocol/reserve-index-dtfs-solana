use crate::state::{Actor, Folio, FolioBasket};
use crate::utils::structs::{FolioStatus, Role};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;
use shared::{
    check_condition,
    constants::{ACTOR_SEEDS, FOLIO_BASKET_SEEDS},
    errors::ErrorCode,
};
/// Remove tokens from the folio's basket.
///
/// # Arguments
/// * `system_program` - The system program.
/// * `folio_owner` - The folio owner account (mut, signer).
/// * `actor` - The actor account (PDA) of the Folio owner (not mut, not signer).
/// * `folio` - The folio account (PDA) (not mut, not signer).
/// * `folio_basket` - The folio basket account (PDA) (mut, not signer).
#[derive(Accounts)]
pub struct RemoveFromBasket<'info> {
    pub system_program: Program<'info, System>,

    #[account(mut)]
    pub folio_owner: Signer<'info>,

    #[account(
        seeds = [ACTOR_SEEDS, folio_owner.key().as_ref(), folio.key().as_ref()],
        bump = actor.bump,
    )]
    pub actor: Account<'info, Actor>,

    #[account()]
    pub folio: AccountLoader<'info, Folio>,

    #[account(mut,
        seeds = [FOLIO_BASKET_SEEDS, folio.key().as_ref()],
        bump
    )]
    pub folio_basket: AccountLoader<'info, FolioBasket>,

    #[account()]
    pub folio_token_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account()]
    pub token_mint: Box<InterfaceAccount<'info, Mint>>,
}

impl RemoveFromBasket<'_> {
    /// Validate the instruction.
    ///
    /// # Checks
    /// * Folio has the correct status.
    /// * Actor is the owner of the folio.
    pub fn validate(&self, folio: &Folio) -> Result<()> {
        folio.validate_folio(
            &self.folio.key(),
            Some(&self.actor),
            Some(vec![Role::Owner]),
            Some(vec![FolioStatus::Initializing, FolioStatus::Initialized]),
        )?;

        check_condition!(
            self.folio_token_mint.key() == folio.folio_token_mint,
            InvalidFolioTokenMint
        );

        Ok(())
    }
}

/// Remove tokens from the folio's basket.
///
/// # Arguments
/// * `ctx` - The context of the instruction.
pub fn handler<'info>(ctx: Context<'_, '_, 'info, 'info, RemoveFromBasket<'info>>) -> Result<()> {
    let folio = ctx.accounts.folio.load()?;
    ctx.accounts.validate(&folio)?;

    let folio_basket = &mut ctx.accounts.folio_basket.load_mut()?;

    let _scaled_folio_token_total_supply =
        folio.get_total_supply(ctx.accounts.folio_token_mint.supply)?;

    let mint_to_remove = ctx.accounts.token_mint.key();
    folio_basket.remove_token_mint_from_basket(mint_to_remove)?;

    Ok(())
}
