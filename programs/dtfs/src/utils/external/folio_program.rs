use anchor_lang::prelude::*;
use shared::constants::DTF_PROGRAM_SIGNER_SEEDS;
use shared::structs::FeeRecipient;
use shared::structs::Range;
use shared::structs::Role;

use crate::AddToBasket;
use crate::AddToPendingBasket;
use crate::ApproveTrade;
use crate::Bid;
use crate::BurnFolioToken;
use crate::ClosePendingTokenAmount;
use crate::CrankFeeDistribution;
use crate::DistributeFees;
use crate::InitOrUpdateActor;
use crate::KillFolio;
use crate::KillTrade;
use crate::MintFolioToken;
use crate::OpenTrade;
use crate::OpenTradePermissionless;
use crate::RedeemFromPendingBasket;
use crate::RemoveActor;
use crate::RemoveFromPendingBasket;
use crate::ResizeFolio;
use crate::UpdateFolio;

pub struct FolioProgram {}

impl FolioProgram {
    pub fn resize_folio_account(ctx: Context<ResizeFolio>, new_size: u64) -> Result<()> {
        let cpi_program = ctx.accounts.folio_program.to_account_info();

        let cpi_accounts = folio::cpi::accounts::ResizeFolio {
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

        folio::cpi::resize_folio(cpi_ctx, new_size)?;

        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn update_folio_account(
        ctx: Context<UpdateFolio>,
        program_version: Option<Pubkey>,
        program_deployment_slot: Option<u64>,
        folio_fee: Option<u64>,
        minting_fee: Option<u64>,
        trade_delay: Option<u64>,
        auction_length: Option<u64>,
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
            fee_recipients: ctx.accounts.fee_recipients.to_account_info(),
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
            folio_fee,
            minting_fee,
            trade_delay,
            auction_length,
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

    pub fn add_to_basket<'info>(
        ctx: Context<'_, '_, 'info, 'info, AddToBasket<'info>>,
        amounts: Vec<u64>,
        initial_shares: Option<u64>,
    ) -> Result<()> {
        let cpi_program = ctx.accounts.folio_program.to_account_info();

        let cpi_accounts = folio::cpi::accounts::AddToBasket {
            system_program: ctx.accounts.system_program.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
            associated_token_program: ctx.accounts.associated_token_program.to_account_info(),
            folio_owner: ctx.accounts.folio_owner.to_account_info(),
            actor: ctx.accounts.actor.to_account_info(),
            dtf_program_signer: ctx.accounts.dtf_program_signer.to_account_info(),
            program_registrar: ctx.accounts.program_registrar.to_account_info(),
            folio: ctx.accounts.folio.to_account_info(),
            folio_pending_basket: ctx.accounts.folio_pending_basket.to_account_info(),
            owner_folio_token_account: ctx.accounts.owner_folio_token_account.to_account_info(),
            folio_token_mint: ctx.accounts.folio_token_mint.to_account_info(),
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

        folio::cpi::add_to_basket(cpi_ctx, amounts, initial_shares)?;

        Ok(())
    }

    pub fn kill_folio(ctx: Context<KillFolio>) -> Result<()> {
        let cpi_program = ctx.accounts.folio_program.to_account_info();

        let cpi_accounts = folio::cpi::accounts::KillFolio {
            system_program: ctx.accounts.system_program.to_account_info(),
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

        folio::cpi::kill_folio(cpi_ctx)?;

        Ok(())
    }

    pub fn add_to_pending_basket<'info>(
        ctx: Context<'_, '_, 'info, 'info, AddToPendingBasket<'info>>,
        amounts: Vec<u64>,
    ) -> Result<()> {
        let cpi_program = ctx.accounts.folio_program.to_account_info();

        let cpi_accounts = folio::cpi::accounts::AddToPendingBasket {
            system_program: ctx.accounts.system_program.to_account_info(),
            rent: ctx.accounts.rent.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
            user: ctx.accounts.user.to_account_info(),
            program_registrar: ctx.accounts.program_registrar.to_account_info(),
            dtf_program_signer: ctx.accounts.dtf_program_signer.to_account_info(),
            folio: ctx.accounts.folio.to_account_info(),
            folio_pending_basket: ctx.accounts.folio_pending_basket.to_account_info(),
            user_pending_basket: ctx.accounts.user_pending_basket.to_account_info(),
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

        folio::cpi::add_to_pending_basket(cpi_ctx, amounts)?;

        Ok(())
    }

    pub fn remove_from_pending_basket<'info>(
        ctx: Context<'_, '_, 'info, 'info, RemoveFromPendingBasket<'info>>,
        amounts: Vec<u64>,
    ) -> Result<()> {
        let cpi_program = ctx.accounts.folio_program.to_account_info();

        let cpi_accounts = folio::cpi::accounts::RemoveFromPendingBasket {
            system_program: ctx.accounts.system_program.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
            user: ctx.accounts.user.to_account_info(),
            program_registrar: ctx.accounts.program_registrar.to_account_info(),
            dtf_program_signer: ctx.accounts.dtf_program_signer.to_account_info(),
            folio: ctx.accounts.folio.to_account_info(),
            folio_pending_basket: ctx.accounts.folio_pending_basket.to_account_info(),
            user_pending_basket: ctx.accounts.user_pending_basket.to_account_info(),
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

        folio::cpi::remove_from_pending_basket(cpi_ctx, amounts)?;

        Ok(())
    }

    pub fn close_pending_token_amount<'info>(
        ctx: Context<'_, '_, 'info, 'info, ClosePendingTokenAmount<'info>>,
    ) -> Result<()> {
        let cpi_program = ctx.accounts.folio_program.to_account_info();

        let cpi_accounts = folio::cpi::accounts::ClosePendingTokenAmount {
            system_program: ctx.accounts.system_program.to_account_info(),
            user: ctx.accounts.user.to_account_info(),
            program_registrar: ctx.accounts.program_registrar.to_account_info(),
            dtf_program_signer: ctx.accounts.dtf_program_signer.to_account_info(),
            folio: ctx.accounts.folio.to_account_info(),
            user_pending_basket: ctx.accounts.user_pending_basket.to_account_info(),
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

        folio::cpi::close_pending_token_amount(cpi_ctx)?;

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
            dao_fee_config: ctx.accounts.dao_fee_config.to_account_info(),
            folio: ctx.accounts.folio.to_account_info(),
            folio_pending_basket: ctx.accounts.folio_pending_basket.to_account_info(),
            user_pending_basket: ctx.accounts.user_pending_basket.to_account_info(),
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

    pub fn burn_folio_token<'info>(
        ctx: Context<'_, '_, 'info, 'info, BurnFolioToken<'info>>,
        shares: u64,
    ) -> Result<()> {
        let cpi_program = ctx.accounts.folio_program.to_account_info();

        let cpi_accounts = folio::cpi::accounts::BurnFolioToken {
            system_program: ctx.accounts.system_program.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
            associated_token_program: ctx.accounts.associated_token_program.to_account_info(),
            user: ctx.accounts.user.to_account_info(),
            program_registrar: ctx.accounts.program_registrar.to_account_info(),
            dtf_program_signer: ctx.accounts.dtf_program_signer.to_account_info(),
            folio: ctx.accounts.folio.to_account_info(),
            folio_pending_basket: ctx.accounts.folio_pending_basket.to_account_info(),
            user_pending_basket: ctx.accounts.user_pending_basket.to_account_info(),
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

        folio::cpi::burn_folio_token(cpi_ctx, shares)?;

        Ok(())
    }

    pub fn redeem_from_pending_basket<'info>(
        ctx: Context<'_, '_, 'info, 'info, RedeemFromPendingBasket<'info>>,
        amounts: Vec<u64>,
    ) -> Result<()> {
        let cpi_program = ctx.accounts.folio_program.to_account_info();

        let cpi_accounts = folio::cpi::accounts::RedeemFromPendingBasket {
            system_program: ctx.accounts.system_program.to_account_info(),
            rent: ctx.accounts.rent.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
            user: ctx.accounts.user.to_account_info(),
            program_registrar: ctx.accounts.program_registrar.to_account_info(),
            dtf_program_signer: ctx.accounts.dtf_program_signer.to_account_info(),
            folio: ctx.accounts.folio.to_account_info(),
            folio_pending_basket: ctx.accounts.folio_pending_basket.to_account_info(),
            user_pending_basket: ctx.accounts.user_pending_basket.to_account_info(),
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

        folio::cpi::redeem_from_pending_basket(cpi_ctx, amounts)?;

        Ok(())
    }

    pub fn crank_fee_distribution<'info>(
        ctx: Context<'_, '_, 'info, 'info, CrankFeeDistribution<'info>>,
        indices: Vec<u64>,
    ) -> Result<()> {
        let cpi_program = ctx.accounts.folio_program.to_account_info();

        let cpi_accounts = folio::cpi::accounts::CrankFeeDistribution {
            system_program: ctx.accounts.system_program.to_account_info(),
            rent: ctx.accounts.rent.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
            user: ctx.accounts.user.to_account_info(),
            cranker: ctx.accounts.cranker.to_account_info(),
            folio: ctx.accounts.folio.to_account_info(),
            folio_token_mint: ctx.accounts.folio_token_mint.to_account_info(),
            fee_distribution: ctx.accounts.fee_distribution.to_account_info(),
            program_registrar: ctx.accounts.program_registrar.to_account_info(),
            dtf_program_signer: ctx.accounts.dtf_program_signer.to_account_info(),
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

        folio::cpi::crank_fee_distribution(cpi_ctx, indices)?;

        Ok(())
    }

    pub fn distribute_fees<'info>(
        ctx: Context<'_, '_, 'info, 'info, DistributeFees<'info>>,
        index: u64,
    ) -> Result<()> {
        let cpi_program = ctx.accounts.folio_program.to_account_info();

        let cpi_accounts = folio::cpi::accounts::DistributeFees {
            system_program: ctx.accounts.system_program.to_account_info(),
            rent: ctx.accounts.rent.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
            user: ctx.accounts.user.to_account_info(),
            folio: ctx.accounts.folio.to_account_info(),
            folio_token_mint: ctx.accounts.folio_token_mint.to_account_info(),
            fee_recipients: ctx.accounts.fee_recipients.to_account_info(),
            fee_distribution: ctx.accounts.fee_distribution.to_account_info(),
            dao_fee_recipient: ctx.accounts.dao_fee_recipient.to_account_info(),
            program_registrar: ctx.accounts.program_registrar.to_account_info(),
            dtf_program: ctx.accounts.dtf_program.to_account_info(),
            dtf_program_data: ctx.accounts.dtf_program_data.to_account_info(),
            dtf_program_signer: ctx.accounts.dtf_program_signer.to_account_info(),
            dao_fee_config: ctx.accounts.dao_fee_config.to_account_info(),
        };

        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);

        let seeds = &[
            DTF_PROGRAM_SIGNER_SEEDS,
            &[ctx.accounts.dtf_program_signer.bump],
        ];
        let signer_seeds = &[&seeds[..]];

        let cpi_ctx = cpi_ctx.with_signer(signer_seeds);

        folio::cpi::distribute_fees(cpi_ctx, index)?;

        Ok(())
    }

    pub fn approve_trade(
        ctx: Context<ApproveTrade>,
        trade_id: u64,
        sell_limit: Range,
        buy_limit: Range,
        start_price: u64,
        end_price: u64,
        ttl: u64,
    ) -> Result<()> {
        let cpi_program = ctx.accounts.folio_program.to_account_info();

        let cpi_accounts = folio::cpi::accounts::ApproveTrade {
            system_program: ctx.accounts.system_program.to_account_info(),
            rent: ctx.accounts.rent.to_account_info(),
            trade_proposer: ctx.accounts.trade_proposer.to_account_info(),
            actor: ctx.accounts.actor.to_account_info(),
            folio: ctx.accounts.folio.to_account_info(),
            trade: ctx.accounts.trade.to_account_info(),
            buy_mint: ctx.accounts.buy_mint.to_account_info(),
            sell_mint: ctx.accounts.sell_mint.to_account_info(),
            program_registrar: ctx.accounts.program_registrar.to_account_info(),
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

        folio::cpi::approve_trade(
            cpi_ctx,
            trade_id,
            sell_limit,
            buy_limit,
            start_price,
            end_price,
            ttl,
        )?;

        Ok(())
    }

    pub fn kill_trade(ctx: Context<KillTrade>) -> Result<()> {
        let cpi_program = ctx.accounts.folio_program.to_account_info();

        let cpi_accounts = folio::cpi::accounts::KillTrade {
            system_program: ctx.accounts.system_program.to_account_info(),
            trade_actor: ctx.accounts.trade_actor.to_account_info(),
            actor: ctx.accounts.actor.to_account_info(),
            folio: ctx.accounts.folio.to_account_info(),
            trade: ctx.accounts.trade.to_account_info(),
            program_registrar: ctx.accounts.program_registrar.to_account_info(),
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

        folio::cpi::kill_trade(cpi_ctx)?;

        Ok(())
    }

    pub fn open_trade(
        ctx: Context<OpenTrade>,
        sell_limit: u64,
        buy_limit: u64,
        start_price: u64,
        end_price: u64,
    ) -> Result<()> {
        let cpi_program = ctx.accounts.folio_program.to_account_info();

        let cpi_accounts = folio::cpi::accounts::OpenTrade {
            system_program: ctx.accounts.system_program.to_account_info(),
            trade_launcher: ctx.accounts.trade_launcher.to_account_info(),
            actor: ctx.accounts.actor.to_account_info(),
            folio: ctx.accounts.folio.to_account_info(),
            trade: ctx.accounts.trade.to_account_info(),
            program_registrar: ctx.accounts.program_registrar.to_account_info(),
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

        folio::cpi::open_trade(cpi_ctx, sell_limit, buy_limit, start_price, end_price)?;

        Ok(())
    }

    pub fn open_trade_permissionless(ctx: Context<OpenTradePermissionless>) -> Result<()> {
        let cpi_program = ctx.accounts.folio_program.to_account_info();

        let cpi_accounts = folio::cpi::accounts::OpenTradePermissionless {
            system_program: ctx.accounts.system_program.to_account_info(),
            user: ctx.accounts.user.to_account_info(),
            folio: ctx.accounts.folio.to_account_info(),
            trade: ctx.accounts.trade.to_account_info(),
            program_registrar: ctx.accounts.program_registrar.to_account_info(),
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

        folio::cpi::open_trade_permissionless(cpi_ctx)?;

        Ok(())
    }

    pub fn bid<'info>(
        ctx: Context<'_, '_, 'info, 'info, Bid<'info>>,
        sell_amount: u64,
        max_buy_amount: u64,
        with_callback: bool,
        callback_data: Vec<u8>,
    ) -> Result<()> {
        let cpi_program = ctx.accounts.folio_program.to_account_info();

        let cpi_accounts = folio::cpi::accounts::Bid {
            system_program: ctx.accounts.system_program.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
            associated_token_program: ctx.accounts.associated_token_program.to_account_info(),
            bidder: ctx.accounts.bidder.to_account_info(),
            folio: ctx.accounts.folio.to_account_info(),
            folio_token_mint: ctx.accounts.folio_token_mint.to_account_info(),
            trade: ctx.accounts.trade.to_account_info(),
            trade_sell_token_mint: ctx.accounts.trade_sell_token_mint.to_account_info(),
            trade_buy_token_mint: ctx.accounts.trade_buy_token_mint.to_account_info(),
            folio_sell_token_account: ctx.accounts.folio_sell_token_account.to_account_info(),
            folio_buy_token_account: ctx.accounts.folio_buy_token_account.to_account_info(),
            bidder_sell_token_account: ctx.accounts.bidder_sell_token_account.to_account_info(),
            bidder_buy_token_account: ctx.accounts.bidder_buy_token_account.to_account_info(),
            program_registrar: ctx.accounts.program_registrar.to_account_info(),
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

        folio::cpi::bid(
            cpi_ctx,
            sell_amount,
            max_buy_amount,
            with_callback,
            callback_data,
        )?;

        Ok(())
    }
}
