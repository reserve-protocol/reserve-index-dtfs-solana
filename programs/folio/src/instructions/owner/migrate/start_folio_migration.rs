use crate::state::{Actor, Folio};
use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::spl_token_2022::instruction::AuthorityType,
    token_interface::{self, Mint, TokenInterface},
};
use shared::{
    check_condition,
    constants::{ACTOR_SEEDS, DTF_PROGRAM_SIGNER_SEEDS, FOLIO_SEEDS},
    structs::{FolioStatus, Role},
};

use crate::state::ProgramRegistrar;
use shared::errors::ErrorCode;

#[derive(Accounts)]
pub struct StartFolioMigration<'info> {
    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,

    #[account(mut)]
    pub folio_owner: Signer<'info>,

    /*
    Account to validate
    */
    #[account(
        seeds = [DTF_PROGRAM_SIGNER_SEEDS],
        bump,
        seeds::program = old_dtf_program.key(),
    )]
    pub old_dtf_program_signer: Signer<'info>,

    /// CHECK: DTF program used for old folio
    #[account(executable)]
    pub old_dtf_program: UncheckedAccount<'info>,

    /// CHECK: DTF program data to validate program deployment slot
    #[account()]
    pub old_dtf_program_data: UncheckedAccount<'info>,

    #[account(
        seeds = [PROGRAM_REGISTRAR_SEEDS],
        bump = program_registrar.bump
    )]
    pub program_registrar: Box<Account<'info, ProgramRegistrar>>,

    /// CHECK: DTF program used for new folio
    #[account(executable)]
    pub new_dtf_program: UncheckedAccount<'info>,

    /// CHECK: Folio program used for new folio
    #[account(executable)]
    pub new_folio_program: UncheckedAccount<'info>,

    #[account(
        seeds = [ACTOR_SEEDS, folio_owner.key().as_ref(), old_folio.key().as_ref()],
        bump = actor.bump,
    )]
    pub actor: Account<'info, Actor>,

    #[account(mut)]
    pub old_folio: AccountLoader<'info, Folio>,

    #[account(mut)]
    pub new_folio: UncheckedAccount<'info>,

    #[account(mut,
    mint::authority = old_folio,
    mint::freeze_authority = old_folio,
    )]
    pub folio_token_mint: Box<InterfaceAccount<'info, Mint>>,
}

impl StartFolioMigration<'_> {
    pub fn validate(&self, old_folio: &Folio) -> Result<()> {
        // Validate old folio, make sure the owner is the one calling the instruction
        old_folio.validate_folio_program_post_init(
            &self.old_folio.key(),
            Some(&self.program_registrar),
            Some(&self.old_dtf_program),
            Some(&self.old_dtf_program_data),
            Some(&self.actor),
            Some(Role::Owner),
            Some(vec![FolioStatus::Initialized]),
        )?;

        /*
        New Folio Validation
         */
        // Make sure the new dtf program is in the registrar
        check_condition!(
            self.program_registrar
                .is_in_registrar(self.new_dtf_program.key()),
            ProgramNotInRegistrar
        );

        // Make sure the new folio is owned by the new folio program
        let folio_token_mint = self.folio_token_mint.key();
        let expected_new_folio_pda = Pubkey::find_program_address(
            &[FOLIO_SEEDS, folio_token_mint.as_ref()],
            &self.new_folio_program.key(),
        );

        check_condition!(
            expected_new_folio_pda.0 == self.new_folio.key(),
            NewFolioNotOwnedByNewDTF
        );

        Ok(())
    }
}

pub fn handler(ctx: Context<StartFolioMigration>) -> Result<()> {
    // TODO how do we validate the new folio program ?
    let old_folio = &mut ctx.accounts.old_folio.load_mut()?;

    ctx.accounts.validate(old_folio)?;

    // Update old folio status
    old_folio.status = FolioStatus::Migrating as u8;

    // Transfer the mint and freeze authority to the new folio
    let token_mint_key = ctx.accounts.folio_token_mint.key();

    let folio_signer_seeds = &[FOLIO_SEEDS, token_mint_key.as_ref(), &[old_folio.bump]];
    let folio_signer = &[&folio_signer_seeds[..]];

    token_interface::set_authority(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token_interface::SetAuthority {
                current_authority: ctx.accounts.old_folio.to_account_info(),
                account_or_mint: ctx.accounts.folio_token_mint.to_account_info(),
            },
            folio_signer,
        ),
        AuthorityType::MintTokens,
        Some(ctx.accounts.new_folio.key()),
    )?;

    token_interface::set_authority(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token_interface::SetAuthority {
                current_authority: ctx.accounts.old_folio.to_account_info(),
                account_or_mint: ctx.accounts.folio_token_mint.to_account_info(),
            },
            folio_signer,
        ),
        AuthorityType::FreezeAccount,
        Some(ctx.accounts.new_folio.key()),
    )?;

    Ok(())
}
