use crate::state::{AuctionEnds, FolioBasket, Rebalance};
use crate::utils::structs::{FolioStatus, Role};
use crate::utils::{OpenAuctionConfig, PricesInAuction};
use crate::{
    events::AuctionOpened,
    state::{Actor, Auction, Folio},
};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;
use folio_admin::state::DAOFeeConfig;
use folio_admin::ID as FOLIO_ADMIN_PROGRAM_ID;
use shared::check_condition;
use shared::constants::{
    ACTOR_SEEDS, AUCTION_ENDS_SEEDS, AUCTION_SEEDS, DAO_FEE_CONFIG_SEEDS, FOLIO_BASKET_SEEDS,
    FOLIO_FEE_CONFIG_SEEDS, REBALANCE_SEEDS,
};
use shared::errors::ErrorCode;

/// Open an auction
/// Auction Launcher only.
///
/// # Arguments
/// * `system_program` - The system program.
/// * `auction_launcher` - The auction launcher account (mut, signer).
/// * `actor` - The actor account (PDA) (not mut, not signer).
/// * `folio` - The folio account (PDA) (mut, not signer).
/// * `auction` - The auction account (PDA) (mut, not signer).
#[derive(Accounts)]
#[instruction(token_1: Pubkey, token_2: Pubkey)]
pub struct OpenAuction<'info> {
    pub system_program: Program<'info, System>,

    #[account(mut)]
    pub auction_launcher: Signer<'info>,

    #[account(
        seeds = [ACTOR_SEEDS, auction_launcher.key().as_ref(), folio.key().as_ref()],
        bump = actor.bump,
    )]
    pub actor: Account<'info, Actor>,

    #[account(mut)]
    pub folio: AccountLoader<'info, Folio>,

    #[account(
        init,
        payer = auction_launcher,
        seeds = [AUCTION_SEEDS, folio.key().as_ref(), rebalance.load()?.nonce.to_le_bytes().as_ref(), rebalance.load()?.get_next_auction_id().to_le_bytes().as_ref()],
        bump,
        space = Auction::SIZE,
    )]
    pub auction: AccountLoader<'info, Auction>,

    pub buy_mint: InterfaceAccount<'info, Mint>,

    pub sell_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [REBALANCE_SEEDS, folio.key().as_ref()],
        bump = rebalance.load()?.bump,
    )]
    pub rebalance: AccountLoader<'info, Rebalance>,

    #[account()]
    pub folio_token_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        seeds = [FOLIO_BASKET_SEEDS, folio.key().as_ref()],
        bump
    )]
    pub folio_basket: AccountLoader<'info, FolioBasket>,

    #[account(
        init_if_needed,
        payer = auction_launcher,
        seeds = [
            AUCTION_ENDS_SEEDS,
            folio.key().as_ref(),
            &rebalance.load()?.nonce.to_le_bytes(),
            token_1.to_bytes().as_ref(),
            token_2.to_bytes().as_ref(),
        ],
        bump,
        space = AuctionEnds::SIZE,
    )]
    pub auction_ends: Account<'info, AuctionEnds>,

    #[account(
        seeds = [DAO_FEE_CONFIG_SEEDS],
        bump,
        seeds::program = FOLIO_ADMIN_PROGRAM_ID,
    )]
    pub dao_fee_config: Account<'info, DAOFeeConfig>,

    /// CHECK: Could be empty or could be set, if set we use that one, else we use dao fee config
    #[account(
        seeds = [FOLIO_FEE_CONFIG_SEEDS, folio.key().as_ref()],
        bump,
        seeds::program = FOLIO_ADMIN_PROGRAM_ID,
    )]
    pub folio_fee_config: UncheckedAccount<'info>,
}

impl OpenAuction<'_> {
    /// Validate the instruction.
    ///
    /// # Checks
    /// * Folio has the correct status and actor has the correct role.
    pub fn validate(
        &self,
        folio: &Folio,
        rebalance: &Rebalance,
        token_1: Pubkey,
        token_2: Pubkey,
    ) -> Result<u8> {
        folio.validate_folio(
            &self.folio.key(),
            Some(&self.actor),
            Some(vec![Role::AuctionLauncher]),
            Some(vec![FolioStatus::Initialized]),
        )?;

        check_condition!(
            self.folio_token_mint.key() == folio.folio_token_mint,
            InvalidFolioTokenMint
        );

        let bump = self
            .auction_ends
            .validate_auction_ends_with_keys_and_get_bump(
                &self.auction_ends.key(),
                &self.folio.key(),
                self.sell_mint.key(),
                self.buy_mint.key(),
                rebalance.nonce,
            )?;

        let (token_1_expected, token_2_expected) =
            AuctionEnds::keys_pair_in_order(self.sell_mint.key(), self.buy_mint.key());
        check_condition!(token_1 == token_1_expected, InvalidTokenMint);
        check_condition!(token_2 == token_2_expected, InvalidTokenMint);

        Ok(bump)
    }
}

/// Open an auction
///
/// # Arguments
/// * `ctx` - The context of the instruction.
/// * `token_1` - The first token mint. Min(sellToken, buyToken)
/// * `token_2` - The second token mint. Max(sellToken, buyToken)
/// * `scaled_sell_limit` - D18{sellTok/share} min ratio of sell token to shares allowed, inclusive
/// * `scaled_buy_limit` - D18{buyTok/share} max balance-ratio to shares allowed, exclusive
/// * `scaled_start_price` - D18{buyTok/sellTok} Price range
/// * `scaled_end_price` - D18{buyTok/sellTok} Price range
pub fn handler(
    ctx: Context<OpenAuction>,
    token_1: Pubkey,
    token_2: Pubkey,
    scaled_sell_limit: u128,
    scaled_buy_limit: u128,
    scaled_start_price: u128,
    scaled_end_price: u128,
) -> Result<()> {
    // auction launcher can:
    //   - select a sell limit within the approved range
    //   - select a buy limit within the approved range
    //   - raise starting price by up to 100x
    //   - raise ending price arbitrarily (can cause auction not to clear, same as closing auction)
    let folio = &mut ctx.accounts.folio.load_mut()?;
    let auction = &mut ctx.accounts.auction.load_init()?;
    auction.bump = ctx.bumps.auction;
    let rebalance = &mut ctx.accounts.rebalance.load_mut()?;
    let folio_basket = &ctx.accounts.folio_basket.load()?;

    let auction_ends_bump = ctx.accounts.validate(folio, rebalance, token_1, token_2)?;

    let config = Some(OpenAuctionConfig {
        price: PricesInAuction {
            start: scaled_start_price,
            end: scaled_end_price,
        },
        sell_limit_spot: scaled_sell_limit,
        buy_limit_spot: scaled_buy_limit,
    });

    let current_time = Clock::get()?.unix_timestamp;
    {
        // Poke folio
        let fee_details = ctx
            .accounts
            .dao_fee_config
            .get_fee_details(&ctx.accounts.folio_fee_config)?;

        folio.poke(
            ctx.accounts.folio_token_mint.supply,
            current_time,
            fee_details.scaled_fee_numerator,
            fee_details.scaled_fee_denominator,
            fee_details.scaled_fee_floor,
        )?;
    }

    let raw_folio_token_supply = ctx.accounts.folio_token_mint.supply;

    let auction_ends = &mut ctx.accounts.auction_ends;
    auction_ends.process_init_if_needed(
        auction_ends_bump,
        ctx.accounts.sell_mint.key(),
        ctx.accounts.buy_mint.key(),
        rebalance.nonce,
    )?;

    let current_time = current_time as u64;

    // Input is also validate in open_auction.
    auction.open_auction(
        folio,
        folio_basket,
        auction_ends,
        raw_folio_token_supply,
        rebalance,
        &ctx.accounts.sell_mint.key(),
        &ctx.accounts.buy_mint.key(),
        current_time,
        0,
        config,
        false,
    )?;

    emit!(AuctionOpened {
        auction_id: auction.id,
        start_price: auction.prices.start,
        end_price: auction.prices.end,
        start: auction.start,
        end: auction.end,
        nonce: auction.nonce,
    });

    Ok(())
}
