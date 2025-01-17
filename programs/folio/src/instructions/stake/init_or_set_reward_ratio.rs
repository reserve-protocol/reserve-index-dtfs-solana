use crate::state::{Actor, Folio, FolioRewardTokens, ProgramRegistrar};
use anchor_lang::prelude::*;
use shared::constants::FOLIO_REWARD_TOKENS_SEEDS;
use shared::structs::FolioStatus;
use shared::{
    constants::{ACTOR_SEEDS, DTF_PROGRAM_SIGNER_SEEDS, PROGRAM_REGISTRAR_SEEDS},
    structs::Role,
};

#[derive(Accounts)]
pub struct InitOrSetRewardRatio<'info> {
    pub system_program: Program<'info, System>,

    #[account(mut)]
    pub folio_owner: Signer<'info>,

    #[account(
        seeds = [ACTOR_SEEDS, folio_owner.key().as_ref(), folio.key().as_ref()],
        bump = actor.bump,
    )]
    pub actor: Account<'info, Actor>,

    #[account()]
    pub folio: AccountLoader<'info, Folio>,

    #[account(init_if_needed,
        payer = folio_owner,
        space = FolioRewardTokens::SIZE,
        seeds = [FOLIO_REWARD_TOKENS_SEEDS, folio.key().as_ref()],
        bump
    )]
    pub folio_reward_tokens: AccountLoader<'info, FolioRewardTokens>,

    /*
    Account to validate
    */
    #[account(
        seeds = [PROGRAM_REGISTRAR_SEEDS],
        bump = program_registrar.bump
    )]
    pub program_registrar: Box<Account<'info, ProgramRegistrar>>,

    #[account(
        seeds = [DTF_PROGRAM_SIGNER_SEEDS],
        bump,
        seeds::program = dtf_program.key(),
    )]
    pub dtf_program_signer: Signer<'info>,

    /// CHECK: DTF program used for creating owner record
    #[account()]
    pub dtf_program: UncheckedAccount<'info>,

    /// CHECK: DTF program data to validate program deployment slot
    #[account()]
    pub dtf_program_data: UncheckedAccount<'info>,
}

impl InitOrSetRewardRatio<'_> {
    pub fn validate(&self, folio: &Folio) -> Result<()> {
        folio.validate_folio_program_post_init(
            &self.folio.key(),
            Some(&self.program_registrar),
            Some(&self.dtf_program),
            Some(&self.dtf_program_data),
            Some(&self.actor),
            Some(Role::Owner),
            Some(vec![FolioStatus::Initializing, FolioStatus::Initialized]),
        )?;

        Ok(())
    }
}

pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, InitOrSetRewardRatio<'info>>,
    reward_period: u64,
) -> Result<()> {
    let folio_key = ctx.accounts.folio.key();
    let folio = ctx.accounts.folio.load()?;
    ctx.accounts.validate(&folio)?;

    FolioRewardTokens::process_init_if_needed(
        &mut ctx.accounts.folio_reward_tokens,
        ctx.bumps.folio_reward_tokens,
        &folio_key,
        None,
        reward_period,
    )?;

    Ok(())
}
