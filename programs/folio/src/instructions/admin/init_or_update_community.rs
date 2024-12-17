use crate::state::Community;
use anchor_lang::prelude::*;
use shared::check_condition;
use shared::constants::common::ADMIN;
use shared::constants::COMMUNITY_SEEDS;
use shared::errors::ErrorCode;

#[derive(Accounts)]
pub struct InitOrUpdateCommunity<'info> {
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,

    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init_if_needed,
        payer = admin,
        space = Community::SIZE,
        seeds = [COMMUNITY_SEEDS],
        bump
    )]
    pub community: Account<'info, Community>,

    /// CHECK: Community Receiver
    pub community_receiver: AccountInfo<'info>,
}

impl<'info> InitOrUpdateCommunity<'info> {
    pub fn validate(&self) -> Result<()> {
        check_condition!(self.admin.key() == ADMIN, Unauthorized);

        Ok(())
    }
}

pub fn handler(ctx: Context<InitOrUpdateCommunity>) -> Result<()> {
    ctx.accounts.validate()?;

    let community = &mut ctx.accounts.community;
    community.bump = ctx.bumps.community;
    community.community_receiver = ctx.accounts.community_receiver.key();

    Ok(())
}
