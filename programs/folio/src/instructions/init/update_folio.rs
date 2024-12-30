use crate::state::{Folio, FolioFeeRecipients, ProgramRegistrar};
use anchor_lang::prelude::*;
use shared::constants::{FOLIO_FEE_RECIPIENTS_SEEDS, MAX_PLATFORM_FEE};
use shared::errors::ErrorCode;
use shared::structs::FeeRecipient;
use shared::{
    check_condition,
    constants::{ACTOR_SEEDS, DTF_PROGRAM_SIGNER_SEEDS, PROGRAM_REGISTRAR_SEEDS},
    structs::Role,
};

#[derive(Accounts)]
pub struct UpdateFolio<'info> {
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,

    #[account(mut)]
    pub folio_owner: Signer<'info>,

    /// CHECK: Actor
    #[account(mut,
        seeds = [ACTOR_SEEDS, folio_owner.key().as_ref(), folio.key().as_ref()],
        bump,
        seeds::program = dtf_program.key()
    )]
    pub actor: AccountInfo<'info>,

    #[account(
        seeds = [DTF_PROGRAM_SIGNER_SEEDS],
        bump,
        seeds::program = dtf_program.key(),
    )]
    pub dtf_program_signer: Signer<'info>,

    #[account(
        seeds = [PROGRAM_REGISTRAR_SEEDS],
        bump = program_registrar.bump
    )]
    pub program_registrar: Box<Account<'info, ProgramRegistrar>>,

    #[account(mut)]
    pub folio: AccountLoader<'info, Folio>,

    #[account(
        init_if_needed,
        space = FolioFeeRecipients::SIZE,
        payer = folio_owner,
        seeds = [FOLIO_FEE_RECIPIENTS_SEEDS, folio.key().as_ref()],
        bump,
    )]
    pub folio_fee_recipients: AccountLoader<'info, FolioFeeRecipients>,

    /// CHECK: DTF program used for creating owner record
    #[account()]
    pub dtf_program: UncheckedAccount<'info>,

    /// CHECK: DTF program data to validate program deployment slot
    #[account()]
    pub dtf_program_data: UncheckedAccount<'info>,
}

impl UpdateFolio<'_> {
    pub fn validate(&self) -> Result<()> {
        let folio = self.folio.load()?;
        folio.validate_folio_program_post_init(
            &self.folio.key(),
            Some(&self.program_registrar),
            Some(&self.dtf_program),
            Some(&self.dtf_program_data),
            Some(&self.actor.to_account_info()),
            Some(Role::Owner),
            None, // Can update no matter the status
        )?;

        Ok(())
    }
}

pub fn handler(
    ctx: Context<UpdateFolio>,
    program_version: Option<Pubkey>,
    program_deployment_slot: Option<u64>,
    fee_per_second: Option<u64>,
    fee_recipients_to_add: Vec<FeeRecipient>,
    fee_recipients_to_remove: Vec<Pubkey>,
) -> Result<()> {
    ctx.accounts.validate()?;

    FolioFeeRecipients::process_init_if_needed(
        &mut ctx.accounts.folio_fee_recipients,
        ctx.bumps.folio_fee_recipients,
        &ctx.accounts.folio.key(),
    )?;

    let mut folio = ctx.accounts.folio.load_mut()?;

    if let Some(program_version) = program_version {
        check_condition!(
            ctx.accounts
                .program_registrar
                .is_in_registrar(program_version),
            InvalidProgram
        );

        folio.program_version = program_version;
    }

    if let Some(program_deployment_slot) = program_deployment_slot {
        folio.program_deployment_slot = program_deployment_slot;
    }

    if let Some(fee_per_second) = fee_per_second {
        check_condition!(fee_per_second <= MAX_PLATFORM_FEE, InvalidFeePerSecond);

        folio.fee_per_second = fee_per_second;
    }

    if !fee_recipients_to_add.is_empty() || !fee_recipients_to_remove.is_empty() {
        let mut fee_recipients = ctx.accounts.folio_fee_recipients.load_mut()?;

        fee_recipients.update_fee_recipients(fee_recipients_to_add, fee_recipients_to_remove)?;
    }

    Ok(())
}
