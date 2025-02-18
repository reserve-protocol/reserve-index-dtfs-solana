use crate::events::{AuctionDelaySet, AuctionLengthSet, MintFeeSet};
use crate::state::{Actor, FeeRecipients, Folio};
use crate::utils::structs::{FeeRecipient, Role};
use anchor_lang::prelude::*;
use shared::constants::{
    FEE_RECIPIENTS_SEEDS, MAX_AUCTION_DELAY, MAX_AUCTION_LENGTH, MAX_MINT_FEE, MAX_TVL_FEE,
    MIN_AUCTION_LENGTH,
};
use shared::errors::ErrorCode;
use shared::{check_condition, constants::ACTOR_SEEDS};

#[derive(Accounts)]
pub struct UpdateFolio<'info> {
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,

    #[account(mut)]
    pub folio_owner: Signer<'info>,

    #[account(
        seeds = [ACTOR_SEEDS, folio_owner.key().as_ref(), folio.key().as_ref()],
        bump = actor.bump,
    )]
    pub actor: Account<'info, Actor>,

    #[account(mut)]
    pub folio: AccountLoader<'info, Folio>,

    #[account(
        init_if_needed,
        space = FeeRecipients::SIZE,
        payer = folio_owner,
        seeds = [FEE_RECIPIENTS_SEEDS, folio.key().as_ref()],
        bump,
    )]
    pub fee_recipients: AccountLoader<'info, FeeRecipients>,
}

impl UpdateFolio<'_> {
    pub fn validate(&self) -> Result<()> {
        let folio = self.folio.load()?;
        folio.validate_folio(
            &self.folio.key(),
            Some(&self.actor),
            Some(Role::Owner),
            None, // Can update no matter the status
        )?;

        Ok(())
    }
}

#[allow(clippy::too_many_arguments)]
pub fn handler(
    ctx: Context<UpdateFolio>,
    tvl_fee: Option<u128>,
    mint_fee: Option<u128>,
    auction_delay: Option<u64>,
    auction_length: Option<u64>,
    fee_recipients_to_add: Vec<FeeRecipient>,
    fee_recipients_to_remove: Vec<Pubkey>,
) -> Result<()> {
    ctx.accounts.validate()?;

    FeeRecipients::process_init_if_needed(
        &mut ctx.accounts.fee_recipients,
        ctx.bumps.fee_recipients,
        &ctx.accounts.folio.key(),
    )?;

    let mut folio = ctx.accounts.folio.load_mut()?;

    if let Some(tvl_fee) = tvl_fee {
        check_condition!(tvl_fee <= MAX_TVL_FEE, TVLFeeTooHigh);

        folio.set_tvl_fee(tvl_fee)?;
    }

    if let Some(mint_fee) = mint_fee {
        check_condition!(mint_fee <= MAX_MINT_FEE, InvalidMintFee);
        folio.mint_fee = mint_fee;

        emit!(MintFeeSet { new_fee: mint_fee });
    }

    if !fee_recipients_to_add.is_empty() || !fee_recipients_to_remove.is_empty() {
        let mut fee_recipients = ctx.accounts.fee_recipients.load_mut()?;

        fee_recipients.update_fee_recipients(fee_recipients_to_add, fee_recipients_to_remove)?;
    }

    if let Some(auction_delay) = auction_delay {
        check_condition!(auction_delay <= MAX_AUCTION_DELAY, InvalidAuctionDelay);

        folio.auction_delay = auction_delay;

        emit!(AuctionDelaySet {
            new_auction_delay: auction_delay
        });
    }

    if let Some(auction_length) = auction_length {
        check_condition!(
            (MIN_AUCTION_LENGTH..=MAX_AUCTION_LENGTH).contains(&auction_length),
            InvalidAuctionLength
        );

        folio.auction_length = auction_length;

        emit!(AuctionLengthSet {
            new_auction_length: auction_length
        });
    }

    Ok(())
}
