use anchor_lang::prelude::*;
use shared::constants::DTF_PROGRAM_SIGNER_SEEDS;
use shared::structs::FeeRecipient;

use crate::state::DtfProgramSigner;
use crate::InitOrUpdateActor;
use crate::ResizeFolio;
use crate::UpdateFolio;
use folio::cpi::accounts::ResizeFolioAccount;
pub struct FolioProgram {}

impl FolioProgram {
    pub fn resize_folio_account(ctx: Context<ResizeFolio>, new_size: u64) -> Result<()> {
        let cpi_program = ctx.accounts.folio_program.to_account_info();

        let cpi_accounts = ResizeFolioAccount {
            system_program: ctx.accounts.system_program.to_account_info(),
            rent: ctx.accounts.rent.to_account_info(),
            folio_owner: ctx.accounts.folio_owner.to_account_info(),
            actor: ctx.accounts.actor.to_account_info(),
            dtf_program_signer: ctx.accounts.dtf_program_signer.to_account_info(),
            program_registrar: ctx.accounts.program_registrar.to_account_info(),
            folio: ctx.accounts.folio.to_account_info(),
            folio_token_mint: ctx.accounts.folio_token_mint.to_account_info(),
            dtf_program: ctx.accounts.dtf_program.to_account_info(),
            dtf_program_data: ctx.accounts.dtf_program_data.to_account_info(),
        };

        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);

        let seeds = &[
            DTF_PROGRAM_SIGNER_SEEDS,
            &[ctx.accounts.dtf_program_signer.bump],
        ];
        let signer_seeds = &[&seeds[..]];

        let cpi_ctx = cpi_ctx.with_signer(signer_seeds);

        folio::cpi::resize_folio_account(cpi_ctx, new_size)?;

        Ok(())
    }

    pub fn update_folio_account(
        ctx: Context<UpdateFolio>,
        program_version: Option<Pubkey>,
        program_deployment_slot: Option<u64>,
        fee_per_second: Option<u64>,
        fee_recipients_to_add: Vec<FeeRecipient>,
        fee_recipients_to_remove: Vec<Pubkey>,
    ) -> Result<()> {
        let cpi_program = ctx.accounts.folio_program.to_account_info();

        let cpi_accounts = folio::cpi::accounts::UpdateFolio {
            system_program: ctx.accounts.system_program.to_account_info(),
            rent: ctx.accounts.rent.to_account_info(),
            folio_owner: ctx.accounts.folio_owner.to_account_info(),
            actor: ctx.accounts.actor.to_account_info(),
            dtf_program_signer: ctx.accounts.dtf_program_signer.to_account_info(),
            program_registrar: ctx.accounts.program_registrar.to_account_info(),
            folio: ctx.accounts.folio.to_account_info(),
            folio_token_mint: ctx.accounts.folio_token_mint.to_account_info(),
            dtf_program: ctx.accounts.dtf_program.to_account_info(),
            dtf_program_data: ctx.accounts.dtf_program_data.to_account_info(),
        };

        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);

        let seeds = &[
            DTF_PROGRAM_SIGNER_SEEDS,
            &[ctx.accounts.dtf_program_signer.bump],
        ];
        let signer_seeds = &[&seeds[..]];

        let cpi_ctx = cpi_ctx.with_signer(signer_seeds);

        folio::cpi::update_folio(
            cpi_ctx,
            program_version,
            program_deployment_slot,
            fee_per_second,
            fee_recipients_to_add,
            fee_recipients_to_remove,
        )?;

        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn validate_mutate_actor_action<'info>(
        folio_program: &AccountInfo<'info>,
        folio_owner: &AccountInfo<'info>,
        folio_owner_actor: &AccountInfo<'info>,
        program_registrar: &AccountInfo<'info>,
        folio: &AccountInfo<'info>,
        dtf_program_signer: &Account<'info, DtfProgramSigner>,
        dtf_program: &AccountInfo<'info>,
        dtf_program_data: &AccountInfo<'info>,
    ) -> Result<()> {
        let cpi_program = folio_program.to_account_info();

        let cpi_accounts = folio::cpi::accounts::ValidateMutateActorAction {
            folio_owner: folio_owner.to_account_info(),
            actor: folio_owner_actor.to_account_info(),
            program_registrar: program_registrar.to_account_info(),
            folio: folio.to_account_info(),
            dtf_program_signer: dtf_program_signer.to_account_info(),
            dtf_program: dtf_program.to_account_info(),
            dtf_program_data: dtf_program_data.to_account_info(),
        };

        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);

        let seeds = &[DTF_PROGRAM_SIGNER_SEEDS, &[dtf_program_signer.bump]];
        let signer_seeds = &[&seeds[..]];

        let cpi_ctx = cpi_ctx.with_signer(signer_seeds);

        folio::cpi::validate_mutate_actor_action(cpi_ctx)?;

        Ok(())
    }
}
