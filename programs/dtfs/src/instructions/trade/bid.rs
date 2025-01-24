use anchor_lang::prelude::*;
use anchor_lang::solana_program::bpf_loader_upgradeable;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use folio::state::FolioBasket;
use folio::ID as FOLIO_ID;
use shared::constants::DTF_PROGRAM_SIGNER_SEEDS;

use crate::state::DtfProgramSigner;
use crate::utils::external::folio_program::FolioProgram;
use crate::ID as DTF_PROGRAM_ID;

#[derive(Accounts)]
pub struct Bid<'info> {
    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,

    #[account(mut)]
    pub bidder: Signer<'info>,

    /*
    DTF Program Accounts
    */
    #[account(
        seeds = [DTF_PROGRAM_SIGNER_SEEDS],
        bump = dtf_program_signer.bump
    )]
    pub dtf_program_signer: Account<'info, DtfProgramSigner>,

    /// CHECK: DTF Program
    #[account(address = DTF_PROGRAM_ID)]
    pub dtf_program: UncheckedAccount<'info>,

    /// CHECK: DTF Program Data
    #[account(
        seeds = [DTF_PROGRAM_ID.as_ref()],
        bump,
        seeds::program = &bpf_loader_upgradeable::id()
    )]
    pub dtf_program_data: UncheckedAccount<'info>,

    /*
    Folio Program Accounts
    */
    /// CHECK: Folio Program
    #[account(address = FOLIO_ID)]
    pub folio_program: UncheckedAccount<'info>,

    /// CHECK: Done within the folio program
    #[account(mut)]
    pub folio: UncheckedAccount<'info>,

    /// CHECK: Done within the folio program
    #[account(mut)]
    pub folio_basket: AccountLoader<'info, FolioBasket>,

    /// CHECK: Done within the folio program
    #[account(mut)]
    pub folio_token_mint: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: Done within the folio program
    #[account(mut)]
    pub trade: UncheckedAccount<'info>,

    /// CHECK: Done within the folio program
    #[account(mut)]
    pub trade_sell_token_mint: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: Done within the folio program
    #[account(mut)]
    pub trade_buy_token_mint: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: Done within the folio program
    #[account(mut)]
    pub folio_sell_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: Done within the folio program
    #[account(mut)]
    pub folio_buy_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: Done within the folio program
    #[account(mut)]
    pub bidder_sell_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: Done within the folio program
    #[account(mut)]
    pub bidder_buy_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: Done within the folio program
    pub program_registrar: UncheckedAccount<'info>,
}

impl Bid<'_> {
    pub fn validate(&self) -> Result<()> {
        Ok(())
    }
}

pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, Bid<'info>>,
    sell_amount: u64,
    max_buy_amount: u64,
    with_callback: bool,
    callback_data: Vec<u8>,
) -> Result<()> {
    ctx.accounts.validate()?;

    FolioProgram::bid(
        ctx,
        sell_amount,
        max_buy_amount,
        with_callback,
        callback_data,
    )?;

    Ok(())
}
