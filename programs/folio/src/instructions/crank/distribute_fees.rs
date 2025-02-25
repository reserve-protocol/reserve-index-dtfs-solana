use crate::utils::structs::FolioStatus;
use crate::utils::{Decimal, Rounding};
use crate::ID;
use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address_with_program_id;
use anchor_spl::token;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use folio_admin::state::DAOFeeConfig;
use folio_admin::ID as FOLIO_ADMIN_PROGRAM_ID;
use shared::check_condition;
use shared::constants::{
    D9_U128, DAO_FEE_CONFIG_SEEDS, FEE_DISTRIBUTION_SEEDS, FEE_RECIPIENTS_SEEDS,
    FOLIO_FEE_CONFIG_SEEDS, FOLIO_SEEDS,
};
use shared::errors::ErrorCode;

use crate::events::ProtocolFeePaid;
use crate::state::{FeeDistribution, FeeRecipients, Folio};

#[derive(Accounts)]
#[instruction(index: u64)]
pub struct DistributeFees<'info> {
    pub rent: Sysvar<'info, Rent>,
    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,

    #[account(mut)]
    pub user: Signer<'info>,

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

    /*
    Specific for the instruction
     */
    #[account(mut)]
    pub folio: AccountLoader<'info, Folio>,

    #[account(mut)]
    pub folio_token_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut,
        seeds = [FEE_RECIPIENTS_SEEDS, folio.key().as_ref()],
        bump,
    )]
    pub fee_recipients: AccountLoader<'info, FeeRecipients>,

    #[account(
        init,
        payer = user,
        space = FeeDistribution::SIZE,
        seeds = [FEE_DISTRIBUTION_SEEDS, folio.key().as_ref(), index.to_le_bytes().as_slice()],
        bump,
    )]
    pub fee_distribution: AccountLoader<'info, FeeDistribution>,

    #[account(mut)]
    pub dao_fee_recipient: Box<InterfaceAccount<'info, TokenAccount>>,
}

pub fn validate<'info>(
    folio: &AccountLoader<'info, Folio>,
    fee_recipients: &FeeRecipients,
    folio_token_mint: &InterfaceAccount<'info, Mint>,
    index: u64,
) -> Result<()> {
    let loaded_folio = folio.load()?;

    loaded_folio.validate_folio(
        &folio.key(),
        None,
        None,
        Some(vec![FolioStatus::Initialized, FolioStatus::Killed]),
    )?;

    check_condition!(
        fee_recipients.distribution_index + 1 == index,
        InvalidDistributionIndex
    );

    check_condition!(
        folio_token_mint.key() == loaded_folio.folio_token_mint,
        InvalidFolioTokenMint
    );

    Ok(())
}

pub fn distribute_fees<'info>(
    token_program: &AccountInfo<'info>,
    user: &AccountInfo<'info>,
    dao_fee_config: &Account<'info, DAOFeeConfig>,
    folio_fee_config: &AccountInfo<'info>,
    folio: &AccountLoader<'info, Folio>,
    folio_token_mint: &InterfaceAccount<'info, Mint>,
    fee_recipients: &AccountLoader<'info, FeeRecipients>,
    fee_distribution: &AccountLoader<'info, FeeDistribution>,
    dao_fee_recipient: &AccountInfo<'info>,
    index: u64,
) -> Result<()> {
    {
        let fee_recipients = fee_recipients.load()?;

        validate(folio, &fee_recipients, folio_token_mint, index)?;

        let folio = &mut folio.load_mut()?;

        let fee_details = dao_fee_config.get_fee_details(folio_fee_config)?;

        // Validate token account
        check_condition!(
            dao_fee_recipient.key()
                == get_associated_token_address_with_program_id(
                    &fee_details.fee_recipient,
                    &folio_token_mint.key(),
                    &token_program.key(),
                ),
            InvalidDaoFeeRecipient
        );

        // Update fees by poking
        let current_time = Clock::get()?.unix_timestamp;
        folio.poke(
            folio_token_mint.supply,
            current_time,
            fee_details.scaled_fee_numerator,
            fee_details.scaled_fee_denominator,
            fee_details.scaled_fee_floor,
        )?;
    }

    // Mint fees to dao recipient
    let raw_dao_pending_fee_shares: u64;
    let scaled_fee_recipients_pending_fee_shares_minus_dust: u128;

    {
        let folio_key = folio.key();
        let loaded_folio = folio.load()?;
        let fee_recipients = fee_recipients.load()?;
        let token_mint_key = folio_token_mint.key();

        raw_dao_pending_fee_shares = Decimal::from_scaled(loaded_folio.dao_pending_fee_shares)
            .to_token_amount(Rounding::Floor)?
            .0;

        let bump = loaded_folio.bump;
        let signer_seeds = &[FOLIO_SEEDS, token_mint_key.as_ref(), &[bump]];

        let cpi_accounts = token::MintTo {
            mint: folio_token_mint.to_account_info(),
            to: dao_fee_recipient.to_account_info(),
            authority: folio.to_account_info(),
        };

        token::mint_to(
            CpiContext::new_with_signer(
                token_program.to_account_info(),
                cpi_accounts,
                &[signer_seeds],
            ),
            raw_dao_pending_fee_shares,
        )?;

        // We scale down as token units and bring back in D18, to get the amount
        // minus the dust that we can split
        scaled_fee_recipients_pending_fee_shares_minus_dust =
            (Decimal::from_scaled(loaded_folio.fee_recipients_pending_fee_shares)
                .to_token_amount(Rounding::Floor)?
                .0 as u128)
                .checked_mul(D9_U128)
                .ok_or(ErrorCode::MathOverflow)?;

        // Create new fee distribution for other recipients
        let fee_distribution_loaded = &mut fee_distribution.load_init()?;

        let (fee_distribution_derived_key, bump) = Pubkey::find_program_address(
            &[
                FEE_DISTRIBUTION_SEEDS,
                folio_key.as_ref(),
                index.to_le_bytes().as_slice(),
            ],
            &ID,
        );

        // Make the the derived key is the right one
        check_condition!(
            fee_distribution_derived_key == fee_distribution.key(),
            InvalidFeeDistribution
        );

        fee_distribution_loaded.bump = bump;
        fee_distribution_loaded.index = index;
        fee_distribution_loaded.folio = folio_key;
        fee_distribution_loaded.cranker = user.key();
        fee_distribution_loaded.amount_to_distribute =
            scaled_fee_recipients_pending_fee_shares_minus_dust;
        fee_distribution_loaded.fee_recipients_state = fee_recipients.fee_recipients;

        emit!(ProtocolFeePaid {
            recipient: dao_fee_recipient.key(),
            amount: raw_dao_pending_fee_shares,
        });
    }

    // Update folio pending fees
    {
        let folio = &mut folio.load_mut()?;
        folio.dao_pending_fee_shares = folio
            .dao_pending_fee_shares
            .checked_sub(
                (raw_dao_pending_fee_shares as u128)
                    // Got to multiply back in D18 since we track with extra precision
                    .checked_mul(D9_U128)
                    .ok_or(ErrorCode::MathOverflow)?,
            )
            .ok_or(ErrorCode::MathOverflow)?;

        folio.fee_recipients_pending_fee_shares = folio
            .fee_recipients_pending_fee_shares
            .checked_sub(scaled_fee_recipients_pending_fee_shares_minus_dust)
            .unwrap();

        let fee_recipients = &mut fee_recipients.load_mut()?;
        fee_recipients.distribution_index = index;
    }

    Ok(())
}

pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, DistributeFees<'info>>,
    index: u64,
) -> Result<()> {
    distribute_fees(
        &ctx.accounts.token_program,
        &ctx.accounts.user,
        &ctx.accounts.dao_fee_config,
        &ctx.accounts.folio_fee_config,
        &ctx.accounts.folio,
        &ctx.accounts.folio_token_mint,
        &ctx.accounts.fee_recipients,
        &ctx.accounts.fee_distribution,
        &ctx.accounts.dao_fee_recipient.to_account_info(),
        index,
    )?;

    Ok(())
}
