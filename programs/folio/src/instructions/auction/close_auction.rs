use crate::utils::structs::{FolioStatus, Role};
use crate::{
    events::AuctionClosed,
    state::{Actor, Auction, Folio},
};
use anchor_lang::prelude::*;
use shared::constants::ACTOR_SEEDS;

#[derive(Accounts)]
pub struct CloseAuction<'info> {
    pub system_program: Program<'info, System>,

    #[account(mut)]
    pub auction_actor: Signer<'info>,

    #[account(
        seeds = [ACTOR_SEEDS, auction_actor.key().as_ref(), folio.key().as_ref()],
        bump = actor.bump,
    )]
    pub actor: Account<'info, Actor>,

    #[account(mut)]
    pub folio: AccountLoader<'info, Folio>,

    #[account(mut)]
    pub auction: AccountLoader<'info, Auction>,
}

impl CloseAuction<'_> {
    pub fn validate(&self, folio: &Folio, auction: &Auction) -> Result<()> {
        folio.validate_folio(
            &self.folio.key(),
            Some(&self.actor),
            Some(vec![
                Role::AuctionApprover,
                Role::AuctionLauncher,
                Role::Owner,
            ]),
            Some(vec![FolioStatus::Initialized, FolioStatus::Initializing]),
        )?;

        auction.validate_auction(&self.auction.key(), &self.folio.key())?;

        Ok(())
    }
}

pub fn handler(ctx: Context<CloseAuction>) -> Result<()> {
    let folio = &mut ctx.accounts.folio.load_mut()?;
    let auction = &mut ctx.accounts.auction.load_mut()?;

    ctx.accounts.validate(folio, auction)?;

    auction.end = 1;

    emit!(AuctionClosed {
        auction_id: auction.id
    });

    Ok(())
}
