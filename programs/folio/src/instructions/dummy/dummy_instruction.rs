use anchor_lang::prelude::*;

use crate::state::UserRewardInfo;

/*
This is used to trigger anchor idl generation for accounts that aren't explicitely used in instruction's context, so anchor skips them.
 */

#[derive(Accounts)]
pub struct IdlIncludeAccount<'info> {
    pub test_proop: Account<'info, UserRewardInfo>,
}

/// Dummy instruction to ensure the account is added to the IDL
pub fn idl_include_account(_ctx: Context<IdlIncludeAccount>) -> Result<()> {
    Ok(())
}
