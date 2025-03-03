use crate::state::{DAOFeeConfig, FolioFeeConfig};
use crate::utils::FolioProgram;
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenInterface};
use shared::check_condition;
use shared::constants::common::ADMIN;
use shared::constants::{
    DAO_FEE_CONFIG_SEEDS, FOLIO_FEE_CONFIG_SEEDS, FOLIO_PROGRAM_ID, FOLIO_SEEDS, MAX_DAO_FEE,
    MAX_FEE_FLOOR,
};
use shared::errors::ErrorCode;

/// Set the Folio fee config.
///
/// # Arguments
/// * `system_program` - The system program.
/// * `rent` - The rent sysvar.
/// * `token_program` - The token program.
/// * `admin` - The admin account (mut, signer).
/// * `dao_fee_config` - The DAO fee config account (PDA) (not mut, not signer).
/// * `folio_token_mint` - The folio token mint account (mut, not signer).
/// * `folio` - The folio account (PDA) (mut, not signer).
/// * `folio_fee_config` - The folio fee config account (PDA) (init_if_needed, not signer).
/// * `folio_program` - The folio program account (CHECK: executable).
/// * `fee_recipients` - The folio fee recipients account (mut).
/// * `fee_distribution` - The folio fee distribution account (mut).
/// * `dao_fee_recipient` - The DAO fee recipient account's token account (mut).
#[derive(Accounts)]
pub struct SetFolioFeeConfig<'info> {
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
    pub token_program: Interface<'info, TokenInterface>,

    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        seeds = [DAO_FEE_CONFIG_SEEDS],
        bump = dao_fee_config.bump
    )]
    pub dao_fee_config: Account<'info, DAOFeeConfig>,

    /// CHECK: Folio token mint
    #[account(mut)]
    pub folio_token_mint: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: Folio account
    #[account(mut,
        seeds = [FOLIO_SEEDS, folio_token_mint.key().as_ref()],
        bump,
        seeds::program = FOLIO_PROGRAM_ID,
    )]
    pub folio: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = admin,
        space = FolioFeeConfig::SIZE,
        seeds = [FOLIO_FEE_CONFIG_SEEDS, folio.key().as_ref()],
        bump
    )]
    pub folio_fee_config: Account<'info, FolioFeeConfig>,

    /*
    Specific accounts for the distribute fees instruction
     */
    /// CHECK: Folio program account
    #[account(address = FOLIO_PROGRAM_ID, executable)]
    pub folio_program: UncheckedAccount<'info>,

    /// CHECK: Fee recipients account, checks done on the folio program
    #[account(mut)]
    pub fee_recipients: UncheckedAccount<'info>,

    /// CHECK: Fee distribution account, checks done on the folio program
    #[account(mut)]
    pub fee_distribution: UncheckedAccount<'info>,

    /// CHECK: DAO fee recipient account, checks done on the folio program
    #[account(mut)]
    pub dao_fee_recipient: UncheckedAccount<'info>,
}

impl SetFolioFeeConfig<'_> {
    /// Validate the instruction.
    ///
    /// # Checks
    /// * Admin account is the authorized admin.
    /// * Fee numerator is less than or equal to the max DAO fee.
    /// * Fee floor is less than or equal to the max fee floor.
    pub fn validate(
        &self,
        scaled_fee_numerator: &Option<u128>,
        scaled_fee_floor: &Option<u128>,
    ) -> Result<()> {
        check_condition!(self.admin.key() == ADMIN, Unauthorized);

        if let Some(scaled_fee_numerator) = scaled_fee_numerator {
            check_condition!(*scaled_fee_numerator <= MAX_DAO_FEE, InvalidFeeNumerator);
        }

        if let Some(scaled_fee_floor) = scaled_fee_floor {
            check_condition!(*scaled_fee_floor <= MAX_FEE_FLOOR, InvalidFeeFloor);
        }

        Ok(())
    }
}

/// Set the Folio fee config.
///
/// # Arguments
/// * `ctx` - The context of the instruction.
/// * `scaled_fee_numerator` - The fee numerator of the Folio, scaled in D18.
/// * `scaled_fee_floor` - The fee floor of the Folio, scaled in D18.
pub fn handler(
    ctx: Context<SetFolioFeeConfig>,
    scaled_fee_numerator: Option<u128>,
    scaled_fee_floor: Option<u128>,
) -> Result<()> {
    ctx.accounts
        .validate(&scaled_fee_numerator, &scaled_fee_floor)?;

    // Distribute the accumulated fees to the fee recipients first
    FolioProgram::distribute_fees_cpi(
        &ctx.accounts.folio_program.to_account_info(),
        &ctx.accounts.rent.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        &ctx.accounts.token_program.to_account_info(),
        &ctx.accounts.admin.to_account_info(),
        &ctx.accounts.dao_fee_config.to_account_info(),
        &ctx.accounts.folio_fee_config.to_account_info(),
        &ctx.accounts.folio.to_account_info(),
        &ctx.accounts.folio_token_mint.to_account_info(),
        &ctx.accounts.fee_recipients.to_account_info(),
        &ctx.accounts.fee_distribution.to_account_info(),
        &ctx.accounts.dao_fee_recipient.to_account_info(),
    )?;

    let folio_fee_config = &mut ctx.accounts.folio_fee_config;

    FolioFeeConfig::init_or_update_folio_fee_config(
        folio_fee_config,
        &ctx.accounts.dao_fee_config,
        ctx.bumps.folio_fee_config,
        scaled_fee_numerator,
        scaled_fee_floor,
    )?;

    Ok(())
}
