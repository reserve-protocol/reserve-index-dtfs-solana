use crate::state::{Actor, Folio, ProgramRegistrar};
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use shared::check_condition;
use shared::errors::ErrorCode;
use shared::structs::FolioStatus;
use shared::{
    constants::{ACTOR_SEEDS, DTF_PROGRAM_SIGNER_SEEDS, FOLIO_SEEDS, PROGRAM_REGISTRAR_SEEDS},
    structs::Role,
};

#[derive(Accounts)]
pub struct FinishInitTokensForFolio<'info> {
    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,

    #[account(mut)]
    pub folio_owner: Signer<'info>,

    #[account(mut,
        seeds = [ACTOR_SEEDS, folio_owner.key().as_ref(), folio.key().as_ref()],
        bump = actor.bump,
    )]
    pub actor: Account<'info, Actor>,

    #[account(mut,
        associated_token::mint = folio_token_mint,
        associated_token::authority = folio_owner,
    )]
    pub owner_folio_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

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

    #[account(mut)]
    pub folio_token_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(init,
    payer = folio_owner,
    associated_token::mint = folio_token_mint,
    associated_token::authority = folio,
    )]
    pub folio_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: DTF program used for creating owner record
    #[account()]
    pub dtf_program: UncheckedAccount<'info>,

    /// CHECK: DTF program data to validate program deployment slot
    #[account()]
    pub dtf_program_data: UncheckedAccount<'info>,
}

impl FinishInitTokensForFolio<'_> {
    pub fn validate(&self, folio: &Folio) -> Result<()> {
        folio.validate_folio_program_post_init(
            &self.folio.key(),
            Some(&self.program_registrar),
            Some(&self.dtf_program),
            Some(&self.dtf_program_data),
            Some(&self.actor),
            Some(Role::Owner),
            Some(FolioStatus::Initializing), // Can only finish initializing while it's initializing
        )?;

        check_condition!(
            self.folio_token_mint.key() == folio.folio_token_mint,
            InvalidFolioTokenMint
        );

        Ok(())
    }
}

pub fn handler(ctx: Context<FinishInitTokensForFolio>, initial_shares: u64) -> Result<()> {
    let folio_account_info = ctx.accounts.folio.to_account_info();

    {
        let folio = &mut ctx.accounts.folio.load_mut()?;
        ctx.accounts.validate(folio)?;
        folio.status = FolioStatus::Initialized as u8;
    }

    let token_mint_key = ctx.accounts.folio_token_mint.key();
    let bump = ctx.accounts.folio.load()?.bump;
    let signer_seeds = &[FOLIO_SEEDS, token_mint_key.as_ref(), &[bump]];

    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::MintTo {
                mint: ctx.accounts.folio_token_mint.to_account_info(),
                to: ctx.accounts.owner_folio_token_account.to_account_info(),
                authority: folio_account_info,
            },
            &[signer_seeds],
        ),
        initial_shares,
    )?;

    Ok(())
}
