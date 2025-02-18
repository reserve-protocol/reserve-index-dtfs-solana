use crate::events::RewardTokenAdded;
use crate::state::{Actor, Folio, FolioRewardTokens, RewardInfo};
use crate::utils::structs::{FolioStatus, Role};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount};
use shared::check_condition;
use shared::constants::{ACTOR_SEEDS, FOLIO_REWARD_TOKENS_SEEDS, REWARD_INFO_SEEDS};
use shared::errors::ErrorCode;

#[derive(Accounts)]
pub struct AddRewardToken<'info> {
    pub system_program: Program<'info, System>,

    #[account(mut)]
    pub folio_owner: Signer<'info>,

    #[account(
        seeds = [ACTOR_SEEDS, folio_owner.key().as_ref(), folio.key().as_ref()],
        bump = actor.bump,
    )]
    pub actor: Account<'info, Actor>,

    #[account()]
    pub folio: AccountLoader<'info, Folio>,

    #[account(init_if_needed,
        payer = folio_owner,
        space = FolioRewardTokens::SIZE,
        seeds = [FOLIO_REWARD_TOKENS_SEEDS, folio.key().as_ref()],
        bump
    )]
    pub folio_reward_tokens: AccountLoader<'info, FolioRewardTokens>,

    #[account()]
    pub reward_token: Box<InterfaceAccount<'info, Mint>>,

    #[account(init_if_needed,
        payer = folio_owner,
        space = RewardInfo::SIZE,
        seeds = [REWARD_INFO_SEEDS, folio.key().as_ref(), reward_token.key().as_ref()],
        bump
    )]
    pub reward_token_reward_info: Account<'info, RewardInfo>,

    #[account()]
    pub reward_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
}

impl AddRewardToken<'_> {
    pub fn validate(&self, folio: &Folio) -> Result<()> {
        folio.validate_folio(
            &self.folio.key(),
            Some(&self.actor),
            Some(vec![Role::Owner]),
            Some(vec![FolioStatus::Initializing, FolioStatus::Initialized]),
        )?;

        check_condition!(
            self.reward_token.key() != folio.folio_token_mint,
            InvalidRewardToken
        );

        check_condition!(
            self.reward_token_account.mint == self.reward_token.key(),
            InvalidRewardMint
        );

        // Token owner needs to be the folio reward tokens account, so we can sign
        check_condition!(
            self.reward_token_account.owner == self.folio_reward_tokens.key(),
            InvalidRewardTokenAccount
        );

        Ok(())
    }
}

pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, AddRewardToken<'info>>,
    reward_period: u64,
) -> Result<()> {
    let folio_key = ctx.accounts.folio.key();
    let folio = ctx.accounts.folio.load()?;
    ctx.accounts.validate(&folio)?;

    FolioRewardTokens::process_init_if_needed(
        &mut ctx.accounts.folio_reward_tokens,
        ctx.bumps.folio_reward_tokens,
        &folio_key,
        Some(&ctx.accounts.reward_token.key()),
        reward_period,
    )?;

    RewardInfo::process_init_if_needed(
        &mut ctx.accounts.reward_token_reward_info,
        ctx.bumps.reward_token_reward_info,
        &folio_key,
        &ctx.accounts.reward_token.key(),
        ctx.accounts.reward_token_account.amount,
    )?;

    emit!(RewardTokenAdded {
        reward_token: ctx.accounts.reward_token.key(),
    });

    Ok(())
}
