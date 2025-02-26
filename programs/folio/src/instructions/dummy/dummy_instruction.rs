use anchor_lang::prelude::*;

use crate::state::UserRewardInfo;

/// Dummy instruction to ensure the account is added to the IDL, since UserRewardInfo is not used in any instruction's context, we have
/// to add it to the IDL "manually", so that Anchor doesn't skip it.
#[derive(Accounts)]
pub struct IdlIncludeAccount<'info> {
    /// Will always crash so no one can use this instruction.
    #[account(
        constraint = dummy_idl_account.key() == Pubkey::default() && dummy_idl_account.key() != Pubkey::default()
    )]
    pub dummy_idl_account: Account<'info, UserRewardInfo>,
}

pub fn idl_include_account(_ctx: Context<IdlIncludeAccount>) -> Result<()> {
    Ok(())
}
