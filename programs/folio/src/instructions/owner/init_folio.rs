use crate::{
    events::FolioCreated,
    state::{Actor, Folio},
    utils::{FixedSizeString, MAX_PADDED_STRING_LENGTH},
    CreateMetadataAccount, Metaplex,
};
use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, TokenInterface},
};
use shared::{
    check_condition,
    constants::{
        ACTOR_SEEDS, FOLIO_SEEDS, MAX_AUCTION_DELAY, MAX_AUCTION_LENGTH, MAX_CONCURRENT_AUCTIONS,
        MAX_MINT_FEE, MAX_TVL_FEE, METADATA_SEEDS, MIN_AUCTION_LENGTH,
    },
};

use crate::utils::structs::{AuctionEnd, FolioStatus, Role};
use shared::errors::ErrorCode;

#[derive(Accounts)]
pub struct InitFolio<'info> {
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,

    #[account(mut)]
    pub folio_owner: Signer<'info>,

    #[account(init,
        payer = folio_owner,
        space = Folio::SIZE,
        seeds = [FOLIO_SEEDS, folio_token_mint.key().as_ref()],
        bump
    )]
    pub folio: AccountLoader<'info, Folio>,

    #[account(init,
    payer = folio_owner,
    mint::decimals = 9,
    mint::authority = folio,
    mint::freeze_authority = folio,
    )]
    pub folio_token_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init,
        payer = folio_owner,
        space = Actor::SIZE,
        seeds = [ACTOR_SEEDS, folio_owner.key().as_ref(), folio.key().as_ref()],
        bump
    )]
    pub actor: Box<Account<'info, Actor>>,

    /*
        Because of solana's limits with stack size, etc.

        the fee_recipients will be created in the update function (if needed)
        the folio_basket will be created in the init tokens (if needed)
    */

    /*
    Metaplex accounts for metadata
     */
    /// CHECK: Token metadata program
    #[account(address = mpl_token_metadata::ID)]
    pub token_metadata_program: UncheckedAccount<'info>,

    /// CHECK: Metadata account
    #[account(
        mut,
        seeds = [
            METADATA_SEEDS,
            mpl_token_metadata::ID.as_ref(),
            folio_token_mint.key().as_ref()
        ],
        seeds::program = mpl_token_metadata::ID,
        bump
    )]
    pub metadata: UncheckedAccount<'info>,
}

impl InitFolio<'_> {
    pub fn validate(
        &self,
        scaled_tvl_fee: u128,
        scaled_mint_fee: u128,
        auction_delay: u64,
        auction_length: u64,
        mandate: &str,
    ) -> Result<()> {
        check_condition!(scaled_tvl_fee <= MAX_TVL_FEE, TVLFeeTooHigh);

        check_condition!(scaled_mint_fee <= MAX_MINT_FEE, InvalidMintFee);

        check_condition!(auction_delay <= MAX_AUCTION_DELAY, InvalidAuctionDelay);
        check_condition!(
            (MIN_AUCTION_LENGTH..=MAX_AUCTION_LENGTH).contains(&auction_length),
            InvalidAuctionLength
        );

        check_condition!(
            mandate.len() <= MAX_PADDED_STRING_LENGTH,
            InvalidMandateLength
        );

        Ok(())
    }
}

impl<'info> CreateMetadataAccount<'info> {
    pub fn from_init_folio(
        ctx: &Context<InitFolio<'info>>,
    ) -> Result<CreateMetadataAccount<'info>> {
        Ok(CreateMetadataAccount {
            system_program: ctx.accounts.system_program.to_account_info(),
            rent: ctx.accounts.rent.to_account_info(),
            mint: ctx.accounts.folio_token_mint.to_account_info(),
            mint_authority: ctx.accounts.folio.to_account_info(),
            payer: ctx.accounts.folio_owner.to_account_info(),
            update_authority: ctx.accounts.folio.to_account_info(),
            metadata: ctx.accounts.metadata.to_account_info(),
            token_metadata_program: ctx.accounts.token_metadata_program.to_account_info(),
        })
    }
}

pub fn handler(
    ctx: Context<InitFolio>,
    scaled_tvl_fee: u128,
    scaled_mint_fee: u128,
    auction_delay: u64,
    auction_length: u64,
    name: String,
    symbol: String,
    uri: String,
    mandate: String,
) -> Result<()> {
    ctx.accounts.validate(
        scaled_tvl_fee,
        scaled_mint_fee,
        auction_delay,
        auction_length,
        &mandate,
    )?;

    let folio_token_mint_key = ctx.accounts.folio_token_mint.key();
    {
        let folio = &mut ctx.accounts.folio.load_init()?;

        folio.bump = ctx.bumps.folio;
        folio.folio_token_mint = folio_token_mint_key;
        folio.set_tvl_fee(scaled_tvl_fee)?;
        folio.mint_fee = scaled_mint_fee;
        folio.status = FolioStatus::Initializing as u8;
        folio.last_poke = Clock::get()?.unix_timestamp;
        folio.dao_pending_fee_shares = 0;
        folio.fee_recipients_pending_fee_shares = 0;
        folio.auction_delay = auction_delay;
        folio.auction_length = auction_length;
        folio.current_auction_id = 0;
        folio.sell_ends = [AuctionEnd::default(); MAX_CONCURRENT_AUCTIONS];
        folio.buy_ends = [AuctionEnd::default(); MAX_CONCURRENT_AUCTIONS];
        folio.mandate = FixedSizeString::new(&mandate);
    }

    let actor = &mut ctx.accounts.actor;
    actor.bump = ctx.bumps.actor;
    actor.authority = ctx.accounts.folio_owner.key();
    actor.folio = ctx.accounts.folio.key();
    Role::add_role(&mut actor.roles, Role::Owner);

    let bump = ctx.bumps.folio;
    let signer_seeds = &[FOLIO_SEEDS, folio_token_mint_key.as_ref(), &[bump]];

    Metaplex::create_metadata_account(
        &CreateMetadataAccount::from_init_folio(&ctx)?,
        name,
        symbol,
        uri,
        &[&signer_seeds[..]],
    )?;

    emit!(FolioCreated {
        folio_token_mint: ctx.accounts.folio_token_mint.key(),
    });

    Ok(())
}
