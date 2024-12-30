use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::get_associated_token_address_with_program_id,
    token_interface::{self, Mint, TokenInterface, TransferChecked},
};
use shared::{
    check_condition,
    constants::{
        FOLIO_SEEDS, IS_ADDING_TO_MINT_FOLIO, PENDING_TOKEN_AMOUNTS_SEEDS, PROGRAM_REGISTRAR_SEEDS,
    },
    structs::TokenAmount,
};
use shared::{constants::DTF_PROGRAM_SIGNER_SEEDS, errors::ErrorCode::*};
use shared::{errors::ErrorCode, structs::FolioStatus};

use crate::state::{Folio, PendingTokenAmounts, ProgramRegistrar};

#[derive(Accounts)]
#[instruction(is_adding_to_mint_folio: u8)]
pub struct ClosePendingTokenAmount<'info> {
    pub system_program: Program<'info, System>,

    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        seeds = [PROGRAM_REGISTRAR_SEEDS],
        bump = program_registrar.bump
    )]
    pub program_registrar: Box<Account<'info, ProgramRegistrar>>,

    #[account()]
    pub folio: AccountLoader<'info, Folio>,

    #[account(mut,
        seeds = [PENDING_TOKEN_AMOUNTS_SEEDS, folio.key().as_ref(), user.key().as_ref(), &[is_adding_to_mint_folio]],
        bump
    )]
    pub user_pending_token_amounts: AccountLoader<'info, PendingTokenAmounts>,

    /// CHECK: DTF program used for creating owner record
    #[account()]
    pub dtf_program: UncheckedAccount<'info>,

    /// CHECK: DTF program data to validate program deployment slot
    #[account()]
    pub dtf_program_data: UncheckedAccount<'info>,

    #[account(
        seeds = [DTF_PROGRAM_SIGNER_SEEDS],
        bump,
        seeds::program = dtf_program.key(),
    )]
    pub dtf_program_signer: Signer<'info>,
}

impl ClosePendingTokenAmount<'_> {
    pub fn validate(&self) -> Result<()> {
        self.folio.load()?.validate_folio_program_post_init(
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
    ctx: Context<'_, '_, 'info, 'info, ClosePendingTokenAmount<'info>>,
    _is_adding_to_mint_folio: u8,
) -> Result<()> {
    ctx.accounts.validate()?;

    {
        let pending_token_amounts = &mut ctx.accounts.user_pending_token_amounts.load_mut()?;

        check_condition!(
            pending_token_amounts.is_empty(),
            PendingTokenAmountsIsNotEmpty
        );

        // To prevent re-init attacks, we re-init the actor with default values
        pending_token_amounts.reset();
    }

    ctx.accounts
        .user_pending_token_amounts
        .close(ctx.accounts.user.to_account_info())?;

    Ok(())
}
