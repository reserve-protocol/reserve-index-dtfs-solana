use crate::pending_token_amounts;
use crate::state::{Folio, PendingTokenAmounts, ProgramRegistrar};
use anchor_lang::prelude::*;
use anchor_lang::solana_program::system_program;
use shared::constants::{IS_ADDING_TO_MINT_FOLIO, PENDING_TOKEN_AMOUNTS_SEEDS};
use shared::errors::ErrorCode;
use shared::structs::{FeeRecipient, FolioStatus, TokenAmount};
use shared::{
    check_condition,
    constants::{ACTOR_SEEDS, DTF_PROGRAM_SIGNER_SEEDS, FOLIO_SEEDS, PROGRAM_REGISTRAR_SEEDS},
    structs::Role,
};

#[derive(Accounts)]
pub struct InitTokensForFolio<'info> {
    pub system_program: Program<'info, System>,

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

    #[account(mut)]
    pub folio: AccountLoader<'info, Folio>,

    #[account(init_if_needed,
        payer = folio_owner,
        space = PendingTokenAmounts::SIZE,
        seeds = [PENDING_TOKEN_AMOUNTS_SEEDS, folio.key().as_ref()],
        bump
    )]
    pub folio_pending_token_amounts: AccountLoader<'info, PendingTokenAmounts>,

    /// CHECK: DTF program used for creating owner record
    #[account()]
    pub dtf_program: UncheckedAccount<'info>,

    /// CHECK: DTF program data to validate program deployment slot
    #[account()]
    pub dtf_program_data: UncheckedAccount<'info>,
    /*
    Remaining accounts will have as many as possible of the following:
        - Token Mint (read)
     */
}

impl<'info> InitTokensForFolio<'info> {
    pub fn validate(&self) -> Result<()> {
        let folio = self.folio.load()?;
        folio.validate_folio_program_post_init(
            &self.folio.key(),
            Some(&self.program_registrar),
            Some(&self.dtf_program),
            Some(&self.dtf_program_data),
            Some(&self.actor.to_account_info()),
            Some(Role::Owner),
            Some(FolioStatus::Initializing), // Can only add new tokens while it's initializing
        )?;

        Ok(())
    }
}

pub fn handler<'info>(ctx: Context<'_, '_, 'info, 'info, InitTokensForFolio<'info>>) -> Result<()> {
    ctx.accounts.validate()?;

    let remaining_accounts = &ctx.remaining_accounts;

    let mut added_mints: Vec<TokenAmount> = vec![];

    for token_mint in remaining_accounts.iter() {
        added_mints.push(TokenAmount {
            mint: token_mint.key(),
            amount: 0,
        });
    }

    PendingTokenAmounts::process_init_if_needed(
        &mut ctx.accounts.folio_pending_token_amounts,
        ctx.bumps.folio_pending_token_amounts,
        &ctx.accounts.folio.key(),
        &ctx.accounts.folio.key(),
        IS_ADDING_TO_MINT_FOLIO, // Not used
        &added_mints,
        true,
    )?;

    Ok(())
}
