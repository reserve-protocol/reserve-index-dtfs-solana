use crate::utils::structs::FolioStatus;
use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address_with_program_id;
use anchor_spl::token;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use dtfs::state::DAOFeeConfig;
use dtfs::ID as DTF_PROGRAM_ID;
use shared::check_condition;
use shared::constants::{
    DAO_FEE_CONFIG_SEEDS, DAO_FEE_DENOMINATOR, FEE_DISTRIBUTION_SEEDS, FEE_RECIPIENTS_SEEDS,
    FOLIO_SEEDS,
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
            seeds::program = DTF_PROGRAM_ID,
        )]
    pub dao_fee_config: Account<'info, DAOFeeConfig>,

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

impl DistributeFees<'_> {
    pub fn validate(
        &self,
        folio: &Folio,
        fee_recipients: &FeeRecipients,
        index: u64,
    ) -> Result<()> {
        folio.validate_folio(
            &self.folio.key(),
            None,
            None,
            Some(vec![FolioStatus::Initialized]),
        )?;

        check_condition!(
            fee_recipients.distribution_index + 1 == index,
            InvalidDistributionIndex
        );

        check_condition!(
            self.folio_token_mint.key() == folio.folio_token_mint,
            InvalidFolioTokenMint
        );

        Ok(())
    }
}

pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, DistributeFees<'info>>,
    index: u64,
) -> Result<()> {
    {
        let fee_recipients = ctx.accounts.fee_recipients.load()?;
        let folio = &mut ctx.accounts.folio.load_mut()?;

        ctx.accounts.validate(folio, &fee_recipients, index)?;

        let dao_fee_config = &ctx.accounts.dao_fee_config;

        // Validate token account
        check_condition!(
            ctx.accounts.dao_fee_recipient.key()
                == get_associated_token_address_with_program_id(
                    &dao_fee_config.fee_recipient,
                    &ctx.accounts.folio_token_mint.key(),
                    &ctx.accounts.token_program.key(),
                ),
            InvalidDaoFeeRecipient
        );

        // Update fees by poking
        let current_time = Clock::get()?.unix_timestamp;
        folio.poke(
            ctx.accounts.folio_token_mint.supply,
            current_time,
            dao_fee_config.fee_recipient_numerator,
            DAO_FEE_DENOMINATOR,
        )?;
    }

    // Mint fees to dao recipient
    {
        let folio_key = ctx.accounts.folio.key();
        let folio = ctx.accounts.folio.load()?;
        let fee_recipients = ctx.accounts.fee_recipients.load()?;
        let token_mint_key = ctx.accounts.folio_token_mint.key();

        let bump = folio.bump;
        let signer_seeds = &[FOLIO_SEEDS, token_mint_key.as_ref(), &[bump]];

        let cpi_accounts = token::MintTo {
            mint: ctx.accounts.folio_token_mint.to_account_info(),
            to: ctx.accounts.dao_fee_recipient.to_account_info(),
            authority: ctx.accounts.folio.to_account_info(),
        };

        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                cpi_accounts,
                &[signer_seeds],
            ),
            folio.dao_pending_fee_shares,
        )?;

        // Create new fee distribution for other recipients
        let fee_distribution = &mut ctx.accounts.fee_distribution.load_init()?;

        fee_distribution.bump = ctx.bumps.fee_distribution;
        fee_distribution.index = index;
        fee_distribution.folio = folio_key;
        fee_distribution.cranker = ctx.accounts.user.key();
        fee_distribution.amount_to_distribute = folio.fee_recipients_pending_fee_shares;
        fee_distribution.fee_recipients_state = fee_recipients.fee_recipients;

        emit!(ProtocolFeePaid {
            recipient: ctx.accounts.dao_fee_recipient.key(),
            amount: folio.dao_pending_fee_shares,
        });
    }

    // Update pending fee
    {
        let folio = &mut ctx.accounts.folio.load_mut()?;
        folio.dao_pending_fee_shares = 0;
        folio.fee_recipients_pending_fee_shares = 0;

        let fee_recipients = &mut ctx.accounts.fee_recipients.load_mut()?;
        fee_recipients.distribution_index = index;
    }

    Ok(())
}
