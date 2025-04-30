use crate::events::RebalanceStarted;
use crate::state::Rebalance;
use crate::state::{Actor, Folio};
use crate::utils::structs::{FolioStatus, Role};
use crate::utils::RebalancePriceAndLimits;
use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;
use folio_admin::state::DAOFeeConfig;
use folio_admin::ID as FOLIO_ADMIN_PROGRAM_ID;
use shared::constants::{DAO_FEE_CONFIG_SEEDS, FOLIO_FEE_CONFIG_SEEDS, REBALANCE_SEEDS};
use shared::utils::TokenUtil;
use shared::{check_condition, constants::ACTOR_SEEDS, errors::ErrorCode};

/// Start an rebalance.
/// Ending rebalance is done by starting a new rebalance when none exists with `all_rebalance_details_added` false.
/// Rebalance Manager only.
///
/// # Arguments
/// * `system_program` - The system program.
/// * `rebalance_manager` - The account that is starting the rebalance (mut, signer).
/// * `actor` - The actor account (PDA) (not mut, not signer).
/// * `folio` - The folio account (PDA) (mut, not signer).
/// * `rebalance` - The rebalance account (PDA) (init, not signer).
/// * remaining account tokens:
///  - token mints for rebalance
#[derive(Accounts)]
#[instruction()]
pub struct StartRebalance<'info> {
    pub system_program: Program<'info, System>,

    #[account(mut)]
    pub rebalance_manager: Signer<'info>,

    #[account(
        seeds = [ACTOR_SEEDS, rebalance_manager.key().as_ref(), folio.key().as_ref()],
        bump = actor.bump,
    )]
    pub actor: Account<'info, Actor>,

    #[account(mut)]
    pub folio: AccountLoader<'info, Folio>,

    #[account(
        init_if_needed,
        payer = rebalance_manager,
        space = Rebalance::SIZE,
        seeds = [REBALANCE_SEEDS, folio.key().as_ref()],
        bump
    )]
    pub rebalance: AccountLoader<'info, Rebalance>,

    #[account(
        seeds = [DAO_FEE_CONFIG_SEEDS],
        bump,
        seeds::program = FOLIO_ADMIN_PROGRAM_ID,
    )]
    pub dao_fee_config: Account<'info, DAOFeeConfig>,

    /// CHECK: Could be empty or could be set, if set we use that one, else we use dao fee config
    #[account(
        seeds = [FOLIO_FEE_CONFIG_SEEDS, folio.key().as_ref()],
        bump,
        seeds::program = FOLIO_ADMIN_PROGRAM_ID,
    )]
    pub folio_fee_config: UncheckedAccount<'info>,

    #[account(mut)]
    pub folio_token_mint: Box<InterfaceAccount<'info, Mint>>,
    // remaining accounts:
    // - token mints for rebalance
}

impl StartRebalance<'_> {
    /// Validate the instruction.
    ///
    /// # Checks
    /// * Folio has the correct status & actor has the correct role.
    /// * All mints are supported SPL tokens.
    pub fn validate(&self, folio: &Folio, mints: &[AccountInfo]) -> Result<()> {
        folio.validate_folio(
            &self.folio.key(),
            Some(&self.actor),
            Some(vec![Role::RebalanceManager]),
            Some(vec![FolioStatus::Initialized]),
        )?;

        for mint in mints {
            // Validate that the buy mint is a supported SPL token (can only check mint here, will check token account in the bid)
            check_condition!(
                TokenUtil::is_supported_spl_token(Some(mint), None)?,
                UnsupportedSPLToken
            );
        }

        check_condition!(
            self.folio_token_mint.key() == folio.folio_token_mint,
            InvalidFolioTokenMint
        );

        Ok(())
    }
}

/// Approve an auction.
///
/// # Arguments
/// * `ctx` - The context of the instruction.
pub fn handler(
    ctx: Context<StartRebalance>,
    auction_launcher_window: u64,
    ttl: u64,
    prices_and_limits: Vec<RebalancePriceAndLimits>,
    all_rebalance_details_added: bool,
) -> Result<()> {
    let folio_key = ctx.accounts.folio.key();
    let folio = &mut ctx.accounts.folio.load_mut()?;
    let mints = ctx.remaining_accounts;

    ctx.accounts.validate(folio, mints)?;

    let current_time = Clock::get()?.unix_timestamp;
    {
        // Poke folio
        let fee_details = ctx
            .accounts
            .dao_fee_config
            .get_fee_details(&ctx.accounts.folio_fee_config)?;

        folio.poke(
            ctx.accounts.folio_token_mint.supply,
            current_time,
            fee_details.scaled_fee_numerator,
            fee_details.scaled_fee_denominator,
            fee_details.scaled_fee_floor,
        )?;
    }

    // Initialize rebalance account if needed
    Rebalance::process_init_if_needed(
        &mut ctx.accounts.rebalance,
        ctx.bumps.rebalance,
        &folio_key,
    )?;

    let rebalance = &mut ctx.accounts.rebalance.load_init()?;
    let current_time = current_time as u64;
    rebalance.start_rebalance(
        current_time,
        auction_launcher_window,
        ttl,
        mints,
        prices_and_limits,
        all_rebalance_details_added,
    )?;

    if all_rebalance_details_added {
        emit!(RebalanceStarted {
            nonce: rebalance.nonce,
            folio: rebalance.folio,
            started_at: rebalance.started_at,
            restricted_until: rebalance.restricted_until,
            available_until: rebalance.restricted_until,
            details: rebalance.details
        });
    }

    Ok(())
}
