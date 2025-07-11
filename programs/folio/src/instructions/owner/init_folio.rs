use crate::{
    events::FolioCreated,
    state::{Actor, Folio},
    utils::{FixedSizeString, MAX_PADDED_STRING_LENGTH},
    CreateMetadataAccount, Metaplex,
};
use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::ID as TOKEN_PROGRAM_ID,
    token_interface::{Mint, TokenInterface},
};
use shared::{
    check_condition,
    constants::{
        ACTOR_SEEDS, FOLIO_SEEDS, MAX_AUCTION_LENGTH, MAX_MINT_FEE, MAX_TVL_FEE, METADATA_SEEDS,
        MIN_AUCTION_LENGTH,
    },
};

use crate::utils::structs::{FolioStatus, Role};
use shared::errors::ErrorCode;

/// Initialize a new Folio
///
/// # Arguments
/// * `system_program` - The system program.
/// * `rent` - The rent sysvar.
/// * `token_program` - The token program.
/// * `associated_token_program` - The associated token program.
/// * `folio_owner` - The folio owner account (mut, signer).
/// * `folio` - The folio account (PDA) (init, not signer).
/// * `folio_token_mint` - The folio token mint account (init, not signer).
/// * `actor` - The actor account (PDA) of the Folio owner (init, not signer).
/// * `token_metadata_program` - The token metadata program (not mut, not signer).
/// * `metadata` - The metadata account (mut, not signer).
#[derive(Accounts)]
pub struct InitFolio<'info> {
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
    // Folio with Token2022, creation is possible via the init_folio_2022 instruction
    #[account(address = TOKEN_PROGRAM_ID)]
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
    /// Validate the instruction.
    ///
    /// # Checks
    /// * TVL fee is less than or equal to the max TVL fee.
    /// * Mint fee is less than or equal to the max mint fee.
    /// * Auction delay is less than or equal to the max auction delay.
    /// * Auction length is between the min and max auction length.
    /// * Mandate is less than or equal to the max mandate length.
    pub fn validate(
        &self,
        scaled_tvl_fee: u128,
        scaled_mint_fee: u128,
        auction_length: u64,
        mandate: &str,
    ) -> Result<()> {
        check_condition!(scaled_tvl_fee <= MAX_TVL_FEE, TVLFeeTooHigh);

        check_condition!(scaled_mint_fee <= MAX_MINT_FEE, InvalidMintFee);

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
    /// Create a CreateMetadataAccount instruction from an InitFolio context.
    ///
    /// # Arguments
    /// * `ctx` - The context of the instruction.
    ///
    /// # Returns
    /// * A CreateMetadataAccount instruction.
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

/// Initialize a new Folio
///
/// # Arguments
/// * `ctx` - The context of the instruction.
/// * `scaled_tvl_fee` - The TVL fee (D18).
/// * `scaled_mint_fee` - The mint fee (D18).
/// * `auction_length` - The auction length (seconds).
/// * `name` - The name of the folio.
/// * `symbol` - The symbol of the folio.
/// * `uri` - The URI of the folio.
/// * `mandate` - The mandate of the folio.
pub fn handler(
    ctx: Context<InitFolio>,
    scaled_tvl_fee: u128,
    scaled_mint_fee: u128,
    auction_length: u64,
    name: String,
    symbol: String,
    uri: String,
    mandate: String,
) -> Result<()> {
    ctx.accounts
        .validate(scaled_tvl_fee, scaled_mint_fee, auction_length, &mandate)?;

    let folio_token_mint_key = ctx.accounts.folio_token_mint.key();
    {
        let folio = &mut ctx.accounts.folio.load_init()?;

        folio.bump = ctx.bumps.folio;
        folio.folio_token_mint = folio_token_mint_key;
        folio.set_tvl_fee(scaled_tvl_fee)?;
        folio.mint_fee = scaled_mint_fee;
        folio.status = FolioStatus::Initializing as u8;
        folio.last_poke = Clock::get()?.unix_timestamp as u64;
        folio.dao_pending_fee_shares = 0;
        folio.fee_recipients_pending_fee_shares = 0;
        folio.auction_length = auction_length;
        folio.mandate = FixedSizeString::new(&mandate);
        folio.fee_recipients_pending_fee_shares_to_be_minted = 0;
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
