use anchor_lang::prelude::*;
use shared::constants::DTF_PROGRAM_SIGNER_SEEDS;
use shared::structs::FeeRecipient;
use shared::structs::Role;

use crate::AddTokensToFolio;
use crate::ClosePendingTokenAmounts;
use crate::FinalizeFolio;
use crate::InitOrAddMintFolioToken;
use crate::InitOrUpdateActor;
use crate::MintFolioToken;
use crate::RemoveActor;
use crate::RemoveFromMintFolioToken;
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
            folio_fee_recipients: ctx.accounts.folio_fee_recipients.to_account_info(),
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

    pub fn init_or_update_actor<'info>(
        ctx: Context<'_, '_, 'info, 'info, InitOrUpdateActor<'info>>,
        role: Role,
    ) -> Result<()> {
        let cpi_program = ctx.accounts.folio_program.to_account_info();

        let cpi_accounts = folio::cpi::accounts::InitOrUpdateActor {
            system_program: ctx.accounts.system_program.to_account_info(),
            rent: ctx.accounts.rent.to_account_info(),
            folio_owner: ctx.accounts.folio_owner.to_account_info(),
            new_actor_authority: ctx.accounts.new_actor_authority.to_account_info(),
            folio_owner_actor: ctx.accounts.folio_owner_actor.to_account_info(),
            new_actor: ctx.accounts.new_actor.to_account_info(),
            program_registrar: ctx.accounts.program_registrar.to_account_info(),
            folio: ctx.accounts.folio.to_account_info(),
            dtf_program_signer: ctx.accounts.dtf_program_signer.to_account_info(),
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

        folio::cpi::init_or_update_actor(cpi_ctx, role)?;

        Ok(())
    }

    pub fn remove_actor<'info>(
        ctx: Context<'_, '_, 'info, 'info, RemoveActor<'info>>,
        role: Role,
        close_actor: bool,
    ) -> Result<()> {
        let cpi_program = ctx.accounts.folio_program.to_account_info();

        let cpi_accounts = folio::cpi::accounts::RemoveActor {
            system_program: ctx.accounts.system_program.to_account_info(),
            rent: ctx.accounts.rent.to_account_info(),
            folio_owner: ctx.accounts.folio_owner.to_account_info(),
            actor_authority: ctx.accounts.actor_authority.to_account_info(),
            folio_owner_actor: ctx.accounts.folio_owner_actor.to_account_info(),
            actor_to_remove: ctx.accounts.actor_to_remove.to_account_info(),
            program_registrar: ctx.accounts.program_registrar.to_account_info(),
            folio: ctx.accounts.folio.to_account_info(),
            dtf_program_signer: ctx.accounts.dtf_program_signer.to_account_info(),
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

        folio::cpi::remove_actor(cpi_ctx, role, close_actor)?;

        Ok(())
    }

    pub fn init_tokens_for_folio<'info>(
        ctx: Context<'_, '_, 'info, 'info, AddTokensToFolio<'info>>,
    ) -> Result<()> {
        let cpi_program = ctx.accounts.folio_program.to_account_info();

        let cpi_accounts = folio::cpi::accounts::InitTokensForFolio {
            system_program: ctx.accounts.system_program.to_account_info(),
            folio_owner: ctx.accounts.folio_owner.to_account_info(),
            actor: ctx.accounts.actor.to_account_info(),
            dtf_program_signer: ctx.accounts.dtf_program_signer.to_account_info(),
            program_registrar: ctx.accounts.program_registrar.to_account_info(),
            folio: ctx.accounts.folio.to_account_info(),
            folio_pending_token_amounts: ctx.accounts.folio_pending_token_amounts.to_account_info(),
            dtf_program: ctx.accounts.dtf_program.to_account_info(),
            dtf_program_data: ctx.accounts.dtf_program_data.to_account_info(),
        };

        let remaining_accounts = ctx.remaining_accounts.to_vec();

        let cpi_ctx =
            CpiContext::new(cpi_program, cpi_accounts).with_remaining_accounts(remaining_accounts);

        let seeds = &[
            DTF_PROGRAM_SIGNER_SEEDS,
            &[ctx.accounts.dtf_program_signer.bump],
        ];
        let signer_seeds = &[&seeds[..]];

        let cpi_ctx = cpi_ctx.with_signer(signer_seeds);

        folio::cpi::init_tokens_for_folio(cpi_ctx)?;

        Ok(())
    }

    pub fn finalize_folio(ctx: Context<FinalizeFolio>, initial_shares: u64) -> Result<()> {
        let cpi_program = ctx.accounts.folio_program.to_account_info();

        let cpi_accounts = folio::cpi::accounts::FinishInitTokensForFolio {
            system_program: ctx.accounts.system_program.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
            associated_token_program: ctx.accounts.associated_token_program.to_account_info(),
            folio_owner: ctx.accounts.folio_owner.to_account_info(),
            actor: ctx.accounts.actor.to_account_info(),
            owner_folio_token_account: ctx.accounts.owner_folio_token_account.to_account_info(),
            dtf_program_signer: ctx.accounts.dtf_program_signer.to_account_info(),
            program_registrar: ctx.accounts.program_registrar.to_account_info(),
            folio: ctx.accounts.folio.to_account_info(),
            folio_token_mint: ctx.accounts.folio_token_mint.to_account_info(),
            folio_token_account: ctx.accounts.folio_token_account.to_account_info(),
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

        folio::cpi::finish_init_tokens_for_folio(cpi_ctx, initial_shares)?;

        Ok(())
    }

    pub fn init_or_add_mint_folio_token<'info>(
        ctx: Context<'_, '_, 'info, 'info, InitOrAddMintFolioToken<'info>>,
        amounts: Vec<u64>,
    ) -> Result<()> {
        let cpi_program = ctx.accounts.folio_program.to_account_info();

        let cpi_accounts = folio::cpi::accounts::InitOrAddMintFolioToken {
            system_program: ctx.accounts.system_program.to_account_info(),
            rent: ctx.accounts.rent.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
            user: ctx.accounts.user.to_account_info(),
            program_registrar: ctx.accounts.program_registrar.to_account_info(),
            dtf_program_signer: ctx.accounts.dtf_program_signer.to_account_info(),
            folio: ctx.accounts.folio.to_account_info(),
            folio_pending_token_amounts: ctx.accounts.folio_pending_token_amounts.to_account_info(),
            user_pending_token_amounts: ctx.accounts.user_pending_token_amounts.to_account_info(),
            dtf_program: ctx.accounts.dtf_program.to_account_info(),
            dtf_program_data: ctx.accounts.dtf_program_data.to_account_info(),
        };

        let remaining_accounts = ctx.remaining_accounts.to_vec();

        let cpi_ctx =
            CpiContext::new(cpi_program, cpi_accounts).with_remaining_accounts(remaining_accounts);

        let seeds = &[
            DTF_PROGRAM_SIGNER_SEEDS,
            &[ctx.accounts.dtf_program_signer.bump],
        ];
        let signer_seeds = &[&seeds[..]];

        let cpi_ctx = cpi_ctx.with_signer(signer_seeds);

        folio::cpi::init_or_add_mint_folio_token(cpi_ctx, amounts)?;

        Ok(())
    }

    pub fn remove_from_mint_folio_token<'info>(
        ctx: Context<'_, '_, 'info, 'info, RemoveFromMintFolioToken<'info>>,
        amounts: Vec<u64>,
    ) -> Result<()> {
        let cpi_program = ctx.accounts.folio_program.to_account_info();

        let cpi_accounts = folio::cpi::accounts::RemoveFromMintFolioToken {
            system_program: ctx.accounts.system_program.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
            user: ctx.accounts.user.to_account_info(),
            program_registrar: ctx.accounts.program_registrar.to_account_info(),
            dtf_program_signer: ctx.accounts.dtf_program_signer.to_account_info(),
            folio: ctx.accounts.folio.to_account_info(),
            folio_pending_token_amounts: ctx.accounts.folio_pending_token_amounts.to_account_info(),
            user_pending_token_amounts: ctx.accounts.user_pending_token_amounts.to_account_info(),
            dtf_program: ctx.accounts.dtf_program.to_account_info(),
            dtf_program_data: ctx.accounts.dtf_program_data.to_account_info(),
        };

        let remaining_accounts = ctx.remaining_accounts.to_vec();

        let cpi_ctx =
            CpiContext::new(cpi_program, cpi_accounts).with_remaining_accounts(remaining_accounts);

        let seeds = &[
            DTF_PROGRAM_SIGNER_SEEDS,
            &[ctx.accounts.dtf_program_signer.bump],
        ];
        let signer_seeds = &[&seeds[..]];

        let cpi_ctx = cpi_ctx.with_signer(signer_seeds);

        folio::cpi::remove_from_mint_folio_token(cpi_ctx, amounts)?;

        Ok(())
    }

    pub fn close_pending_token_amounts<'info>(
        ctx: Context<'_, '_, 'info, 'info, ClosePendingTokenAmounts<'info>>,
        is_adding_to_mint_folio: u8,
    ) -> Result<()> {
        let cpi_program = ctx.accounts.folio_program.to_account_info();

        let cpi_accounts = folio::cpi::accounts::ClosePendingTokenAmount {
            system_program: ctx.accounts.system_program.to_account_info(),
            user: ctx.accounts.user.to_account_info(),
            program_registrar: ctx.accounts.program_registrar.to_account_info(),
            dtf_program_signer: ctx.accounts.dtf_program_signer.to_account_info(),
            folio: ctx.accounts.folio.to_account_info(),
            user_pending_token_amounts: ctx.accounts.user_pending_token_amounts.to_account_info(),
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

        folio::cpi::close_pending_token_amount(cpi_ctx, is_adding_to_mint_folio)?;

        Ok(())
    }

    pub fn mint_folio_token<'info>(
        ctx: Context<'_, '_, 'info, 'info, MintFolioToken<'info>>,
        shares: u64,
    ) -> Result<()> {
        let cpi_program = ctx.accounts.folio_program.to_account_info();

        let cpi_accounts = folio::cpi::accounts::MintFolioToken {
            system_program: ctx.accounts.system_program.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
            associated_token_program: ctx.accounts.associated_token_program.to_account_info(),
            user: ctx.accounts.user.to_account_info(),
            program_registrar: ctx.accounts.program_registrar.to_account_info(),
            dtf_program_signer: ctx.accounts.dtf_program_signer.to_account_info(),
            folio: ctx.accounts.folio.to_account_info(),
            folio_pending_token_amounts: ctx.accounts.folio_pending_token_amounts.to_account_info(),
            user_pending_token_amounts: ctx.accounts.user_pending_token_amounts.to_account_info(),
            folio_token_mint: ctx.accounts.folio_token_mint.to_account_info(),
            user_folio_token_account: ctx.accounts.user_folio_token_account.to_account_info(),
            dtf_program: ctx.accounts.dtf_program.to_account_info(),
            dtf_program_data: ctx.accounts.dtf_program_data.to_account_info(),
        };

        let remaining_accounts = ctx.remaining_accounts.to_vec();

        let cpi_ctx =
            CpiContext::new(cpi_program, cpi_accounts).with_remaining_accounts(remaining_accounts);

        let seeds = &[
            DTF_PROGRAM_SIGNER_SEEDS,
            &[ctx.accounts.dtf_program_signer.bump],
        ];
        let signer_seeds = &[&seeds[..]];

        let cpi_ctx = cpi_ctx.with_signer(signer_seeds);

        folio::cpi::mint_folio_token(cpi_ctx, shares)?;

        Ok(())
    }
}
