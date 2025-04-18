use crate::{
    events::FolioCreated,
    state::{Actor, Folio},
    utils::structs::{FolioStatus, Role},
    utils::{FixedSizeString, MAX_PADDED_STRING_LENGTH},
};
use anchor_lang::prelude::*;
use anchor_lang::solana_program::rent::{
    DEFAULT_EXEMPTION_THRESHOLD, DEFAULT_LAMPORTS_PER_BYTE_YEAR,
};
use anchor_lang::system_program::{transfer, Transfer};
use anchor_spl::{
    associated_token::AssociatedToken,
    token_2022::{Token2022, ID as TOKEN_2022_PROGRAM_ID},
    token_interface::{token_metadata_initialize, Mint, TokenMetadataInitialize},
};
use shared::{
    check_condition,
    constants::{
        ACTOR_SEEDS, FOLIO_SEEDS, MAX_AUCTION_DELAY, MAX_AUCTION_LENGTH, MAX_CONCURRENT_AUCTIONS,
        MAX_MINT_FEE, MAX_TVL_FEE, MIN_AUCTION_LENGTH,
    },
    errors::ErrorCode,
};
use spl_token_metadata_interface::state::TokenMetadata;
use spl_type_length_value::variable_len_pack::VariableLenPack;

/// Initialize a new Folio with SPL Token-2022
///
/// This instruction is specifically designed for Token-2022 tokens
/// which utilize Anchor's token_2022 annotations for automatic token initialization.
///
/// # Arguments
/// * `system_program` - The system program.
/// * `rent` - The rent sysvar.
/// * `token_program` - The token program (must be Token-2022).
/// * `associated_token_program` - The associated token program.
/// * `folio_owner` - The folio owner account (mut, signer).
/// * `folio` - The folio account (PDA) (init, not signer).
/// * `folio_token_mint` - The folio token mint account (init, not signer).
/// * `actor` - The actor account (PDA) of the Folio owner (init, not signer).
#[derive(Accounts)]
pub struct InitFolio2022<'info> {
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,

    #[account(address = TOKEN_2022_PROGRAM_ID)]
    pub token_program: Program<'info, Token2022>,

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

    #[account(
        init,
        payer = folio_owner,
        mint::decimals = 9,
        mint::authority = folio,
        mint::freeze_authority = folio,
        extensions::metadata_pointer::authority = folio,
        extensions::metadata_pointer::metadata_address = folio_token_mint,
    )]
    pub folio_token_mint: InterfaceAccount<'info, Mint>,

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
}

impl InitFolio2022<'_> {
    /// Validate the instruction.
    ///
    /// # Checks
    /// * TVL fee is less than or equal to the max TVL fee.
    /// * Mint fee is less than or equal to the max mint fee.
    /// * Auction delay is less than or equal to the max auction delay.
    /// * Auction length is between the min and max auction length.
    /// * Mandate is not too long.
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

/// Initialize a new Folio with Token-2022
///
/// # Arguments
/// * `ctx` - The context of the instruction.
/// * `scaled_tvl_fee` - The TVL fee (D18).
/// * `scaled_mint_fee` - The mint fee (D18).
/// * `auction_delay` - The auction delay (seconds).
/// * `auction_length` - The auction length (seconds).
/// * `name` - The name of the folio.
/// * `symbol` - The symbol of the folio.
/// * `uri` - The URI of the folio.
/// * `mandate` - The mandate of the folio.
pub fn handler(
    ctx: Context<InitFolio2022>,
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
    let bump = ctx.bumps.folio;

    {
        let folio = &mut ctx.accounts.folio.load_init()?;

        folio.bump = bump;
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
        folio.sell_ends = [Default::default(); MAX_CONCURRENT_AUCTIONS];
        folio.buy_ends = [Default::default(); MAX_CONCURRENT_AUCTIONS];
        folio.mandate = FixedSizeString::new(&mandate);
    }

    // Setup the actor account
    let actor = &mut ctx.accounts.actor;
    actor.bump = ctx.bumps.actor;
    actor.authority = ctx.accounts.folio_owner.key();
    actor.folio = ctx.accounts.folio.key();
    Role::add_role(&mut actor.roles, Role::Owner);

    // Create the metadata via spl 2022
    let token_metadata = TokenMetadata {
        name: name.clone(),
        symbol: symbol.clone(),
        uri: uri.clone(),
        ..Default::default()
    };

    // Add 4 extra bytes for size of MetadataExtension (2 bytes for type, 2 bytes for length)
    let data_len = 4 + token_metadata.get_packed_len()?;

    // Calculate lamports required for the additional metadata
    let lamports =
        data_len as u64 * DEFAULT_LAMPORTS_PER_BYTE_YEAR * DEFAULT_EXEMPTION_THRESHOLD as u64;

    // Transfer additional lamports to mint account for metadata storage
    transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.folio_owner.to_account_info(),
                to: ctx.accounts.folio_token_mint.to_account_info(),
            },
        ),
        lamports,
    )?;

    // Initialize the token metadata using the Anchor CPI implementation
    let signer_seeds = &[FOLIO_SEEDS, folio_token_mint_key.as_ref(), &[bump]];
    token_metadata_initialize(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TokenMetadataInitialize {
                program_id: ctx.accounts.token_program.to_account_info(),
                mint: ctx.accounts.folio_token_mint.to_account_info(),
                metadata: ctx.accounts.folio_token_mint.to_account_info(),
                mint_authority: ctx.accounts.folio.to_account_info(),
                update_authority: ctx.accounts.folio.to_account_info(),
            },
            &[signer_seeds],
        ),
        name,
        symbol,
        uri,
    )?;

    emit!(FolioCreated {
        folio_token_mint: ctx.accounts.folio_token_mint.key(),
    });

    Ok(())
}
