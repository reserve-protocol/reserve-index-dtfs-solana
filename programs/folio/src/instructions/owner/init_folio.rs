use crate::{
    events::FolioCreated,
    state::{Actor, Folio},
    CreateMetadataAccount, DtfProgram, Metaplex,
};
use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, TokenInterface},
};
use shared::{
    check_condition,
    constants::{
        ACTOR_SEEDS, FOLIO_SEEDS, MAX_AUCTION_LENGTH, MAX_CONCURRENT_TRADES, MAX_FOLIO_FEE, MAX_MINTING_FEE, MAX_TRADE_DELAY, METADATA_SEEDS, MIN_AUCTION_LENGTH, MIN_DAO_MINTING_FEE, PROGRAM_REGISTRAR_SEEDS
    },
    structs::{FolioStatus, Role, TradeEnd},
};

use crate::state::ProgramRegistrar;
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

        the folio token account will be created in finalize folio (if needed)
        the fee_recipients will be created in the update function (if needed)
        the folio_pending_basket will be created in the init tokens (if needed)
    */

    /*
    Account to validate
    */
    #[account(
        seeds = [PROGRAM_REGISTRAR_SEEDS],
        bump = program_registrar.bump
    )]
    pub program_registrar: Box<Account<'info, ProgramRegistrar>>,

    /// CHECK: DTF program used for creating owner record
    #[account()]
    pub dtf_program: UncheckedAccount<'info>,

    /// CHECK: DTF program data to validate program deployment slot
    #[account()]
    pub dtf_program_data: UncheckedAccount<'info>,

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
        folio_fee: u64,
        minting_fee: u64,
        trade_delay: u64,
        auction_length: u64,
    ) -> Result<()> {
        Folio::validate_folio_program_for_init(&self.program_registrar, &self.dtf_program)?;

        check_condition!(folio_fee <= MAX_FOLIO_FEE, InvalidFeePerSecond);

        check_condition!(
            (MIN_DAO_MINTING_FEE..=MAX_MINTING_FEE).contains(&minting_fee),
            InvalidMintingFee
        );

        check_condition!(trade_delay <= MAX_TRADE_DELAY, InvalidTradeDelay);
        check_condition!(
            (MIN_AUCTION_LENGTH..=MAX_AUCTION_LENGTH).contains(&auction_length),
            InvalidAuctionLength
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
    folio_fee: u64,
    minting_fee: u64,
    trade_delay: u64,
    auction_length: u64,
    name: String,
    symbol: String,
) -> Result<()> {
    ctx.accounts
        .validate(folio_fee, minting_fee, trade_delay, auction_length)?;

    let folio_token_mint_key = ctx.accounts.folio_token_mint.key();
    {
        let folio = &mut ctx.accounts.folio.load_init()?;

        let deployment_slot = DtfProgram::get_program_deployment_slot(
            &ctx.accounts.dtf_program.key(),
            &ctx.accounts.dtf_program.to_account_info(),
            &ctx.accounts.dtf_program_data.to_account_info(),
        )?;

        folio.bump = ctx.bumps.folio;
        folio.program_version = ctx.accounts.dtf_program.key();
        folio.program_deployment_slot = deployment_slot;
        folio.folio_token_mint = folio_token_mint_key;
        folio.folio_fee = folio_fee;
        folio.minting_fee = minting_fee;
        folio.status = FolioStatus::Initializing as u8;
        folio.last_poke = Clock::get()?.unix_timestamp;
        folio.dao_pending_fee_shares = 0;
        folio.fee_recipients_pending_fee_shares = 0;
        folio.trade_delay = trade_delay;
        folio.auction_length = auction_length;
        folio.current_trade_id = 0;
        folio.trade_ends = [TradeEnd::default(); MAX_CONCURRENT_TRADES];
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
        &[&signer_seeds[..]],
    )?;

    emit!(FolioCreated {
        folio_token_mint: ctx.accounts.folio_token_mint.key(),
        folio_fee,
    });

    Ok(())
}
