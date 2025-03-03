use crate::state::{Folio, UserPendingBasket};
use anchor_lang::prelude::*;
use shared::errors::ErrorCode;
use shared::{check_condition, constants::USER_PENDING_BASKET_SEEDS};

/// Close the user's pending basket.
///
/// # Arguments
/// * `system_program` - The system program.
/// * `user` - The user account (mut, signer).
/// * `folio` - The folio account (PDA) (not mut, not signer).
/// * `user_pending_basket` - The user pending basket account (PDA) (mut, not signer).
#[derive(Accounts)]
pub struct CloseUserPendingTokenAmount<'info> {
    pub system_program: Program<'info, System>,

    #[account(mut)]
    pub user: Signer<'info>,

    #[account()]
    pub folio: AccountLoader<'info, Folio>,

    #[account(mut,
        seeds = [USER_PENDING_BASKET_SEEDS, folio.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub user_pending_basket: AccountLoader<'info, UserPendingBasket>,
}

impl CloseUserPendingTokenAmount<'_> {
    /// Validate the instruction.
    ///
    /// # Checks
    /// * Folio is valid PDA
    pub fn validate(&self) -> Result<()> {
        self.folio.load()?.validate_folio(
            &self.folio.key(),
            None,
            None,
            // User should always be able to close their pending tokens
            None,
        )?;

        Ok(())
    }
}

/// Close the user's pending basket. This is used to get the rent back from creating a pending basket for the user
///
/// # Arguments
/// * `ctx` - The context of the instruction.
pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, CloseUserPendingTokenAmount<'info>>,
) -> Result<()> {
    ctx.accounts.validate()?;

    {
        let user_pending_basket = &mut ctx.accounts.user_pending_basket.load_mut()?;

        check_condition!(user_pending_basket.is_empty(), PendingBasketIsNotEmpty);

        // To prevent re-init attacks, we re-init the actor with default values
        user_pending_basket.reset();
    }

    ctx.accounts
        .user_pending_basket
        .close(ctx.accounts.user.to_account_info())?;

    Ok(())
}
