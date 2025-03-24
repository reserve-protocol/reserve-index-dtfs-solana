use crate::events::DustLimitSetForToken;
use crate::state::FolioTokenMetadata;
use crate::state::{Actor, Folio};
use crate::utils::structs::Role;
use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;
use shared::constants::{ACTOR_SEEDS, FOLIO_TOKEN_METADATA_SEEDS};

/// Set the dust limit for a token
/// Auction Launcher only.
///
/// # Arguments
/// * `system_program` - The system program.
/// * `user` - The user account (mut, signer).
/// * `actor` - The actor account (PDA) (not mut, not signer).
/// * `folio` - The folio account (PDA) (mut, not signer).
/// * `token_mint` - The token mint account.
/// * `folio_token_metadata` - The folio token metadata account.
#[derive(Accounts)]
pub struct SetDustLimitForToken<'info> {
    pub system_program: Program<'info, System>,

    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        seeds = [ACTOR_SEEDS, user.key().as_ref(), folio.key().as_ref()],
        bump = actor.bump,
    )]
    pub actor: Account<'info, Actor>,

    #[account()]
    pub folio: AccountLoader<'info, Folio>,

    #[account()]
    pub token_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
    init_if_needed,
    payer = user,
    space = FolioTokenMetadata::SIZE,
    seeds = [FOLIO_TOKEN_METADATA_SEEDS, folio.key().as_ref(), token_mint.key().as_ref()],
    bump
    )]
    pub folio_token_metadata: Account<'info, FolioTokenMetadata>,
}

impl SetDustLimitForToken<'_> {
    /// Validate the instruction.
    ///
    /// # Checks
    /// * Folio has the correct status and actor has the correct role.
    pub fn validate(&self, folio: &Folio) -> Result<()> {
        folio.validate_folio(
            &self.folio.key(),
            Some(&self.actor),
            Some(vec![Role::AuctionLauncher, Role::Owner]),
            None,
        )?;

        Ok(())
    }
}

/// Set the dust limit for a token
///
/// # Arguments
/// * `ctx` - The context of the instruction.
/// * `dust_limit` - The dust limit for the token.
pub fn handler(ctx: Context<SetDustLimitForToken>, dust_limit: u128) -> Result<()> {
    let folio = &mut ctx.accounts.folio.load()?;
    ctx.accounts.validate(folio)?;

    if ctx.accounts.folio_token_metadata.mint == Pubkey::default() {
        // The account is not initialized, initialize it.
        ctx.accounts.folio_token_metadata.bump = ctx.bumps.folio_token_metadata;
        ctx.accounts.folio_token_metadata.mint = ctx.accounts.token_mint.key();
        ctx.accounts.folio_token_metadata.folio = ctx.accounts.folio.key();
    }
    ctx.accounts.folio_token_metadata.dust_amount = dust_limit;

    emit!(DustLimitSetForToken {
        token: ctx.accounts.token_mint.key(),
        folio: ctx.accounts.folio.key(),
        dust_limit,
    });

    Ok(())
}
