use anchor_lang::prelude::*;
use shared::constants::DTF_PROGRAM_SIGNER_SEEDS;
use shared::{
    check_condition,
    constants::{PROGRAM_REGISTRAR_SEEDS, USER_PENDING_BASKET_SEEDS},
};
use shared::{errors::ErrorCode, structs::FolioStatus};

use crate::state::{Folio, ProgramRegistrar, UserPendingBasket};

#[derive(Accounts)]
pub struct CloseUserPendingTokenAmount<'info> {
    pub system_program: Program<'info, System>,

    #[account(mut)]
    pub user: Signer<'info>,

    /*
    Accounts to validate
    */
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

    #[account(
        seeds = [PROGRAM_REGISTRAR_SEEDS],
        bump = program_registrar.bump
    )]
    pub program_registrar: Box<Account<'info, ProgramRegistrar>>,

    #[account()]
    pub folio: AccountLoader<'info, Folio>,

    #[account(mut,
        seeds = [USER_PENDING_BASKET_SEEDS, folio.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub user_pending_basket: AccountLoader<'info, UserPendingBasket>,
}

impl CloseUserPendingTokenAmount<'_> {
    pub fn validate(&self) -> Result<()> {
        self.folio.load()?.validate_folio_program_post_init(
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
