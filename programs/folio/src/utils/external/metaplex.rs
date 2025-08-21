use anchor_lang::prelude::*;
use anchor_spl::metadata::mpl_token_metadata::{
    self,
    types::{CollectionDetailsToggle, CollectionToggle, RuleSetToggle, UsesToggle},
};

/// Utility struct for the metaplex program.
pub struct Metaplex {}

/// Create metadata account instruction.
pub struct CreateMetadataAccount<'info> {
    pub metadata: AccountInfo<'info>,
    pub mint: AccountInfo<'info>,
    pub mint_authority: AccountInfo<'info>,
    pub payer: AccountInfo<'info>,
    pub update_authority: AccountInfo<'info>,
    pub system_program: AccountInfo<'info>,
    pub rent: AccountInfo<'info>,
    pub token_metadata_program: AccountInfo<'info>,
}

pub struct UpdateAuthority<'info> {
    pub metadata: AccountInfo<'info>,
    pub mint: AccountInfo<'info>,
    pub mint_authority: AccountInfo<'info>,
    pub payer: AccountInfo<'info>,
    pub update_authority: AccountInfo<'info>,
    pub system_program: AccountInfo<'info>,
    pub rent: AccountInfo<'info>,
    pub token_metadata_program: AccountInfo<'info>,
    pub sysvar_instructions: AccountInfo<'info>,
}

impl Metaplex {
    /// Create a metadata account for a token mint.
    ///
    /// # Arguments
    /// * `ctx` - The create metadata account context.
    /// * `name` - The name of the token.
    /// * `symbol` - The symbol of the token.
    /// * `uri` - The uri of the token.
    /// * `signers_seeds` - The signers seeds of the update authority.
    #[cfg(not(tarpaulin_include))]
    pub fn create_metadata_account(
        ctx: &CreateMetadataAccount,
        name: String,
        symbol: String,
        uri: String,
        signers_seeds: &[&[&[u8]]],
    ) -> Result<()> {
        let cpi_accounts = mpl_token_metadata::instructions::CreateMetadataAccountV3CpiAccounts {
            metadata: &ctx.metadata,
            mint: &ctx.mint,
            mint_authority: &ctx.mint_authority,
            payer: &ctx.payer,
            update_authority: (&ctx.update_authority, true),
            system_program: &ctx.system_program,
            rent: Some(&ctx.rent),
        };

        let metadata_args =
            mpl_token_metadata::instructions::CreateMetadataAccountV3InstructionArgs {
                data: mpl_token_metadata::types::DataV2 {
                    name,
                    symbol,
                    uri,
                    seller_fee_basis_points: 0,
                    creators: None,
                    collection: None,
                    uses: None,
                },
                is_mutable: false,
                collection_details: None,
            };

        let cpi = mpl_token_metadata::instructions::CreateMetadataAccountV3Cpi::new(
            &ctx.token_metadata_program,
            cpi_accounts,
            metadata_args,
        );

        cpi.invoke_signed(signers_seeds)?;

        Ok(())
    }

    pub fn update_metadata_authority(
        ctx: &UpdateAuthority,
        new_authority: Pubkey,
        signers_seeds: &[&[&[u8]]],
    ) -> Result<()> {
        let cpi_accounts = mpl_token_metadata::instructions::UpdateAsUpdateAuthorityV2CpiAccounts {
            metadata: &ctx.metadata,
            mint: &ctx.mint,
            payer: &ctx.payer,
            authority: &ctx.update_authority,
            delegate_record: None,
            token: None,
            edition: None,
            system_program: &ctx.system_program,
            sysvar_instructions: &ctx.sysvar_instructions,
            authorization_rules_program: None,
            authorization_rules: None,
        };
        let update_authority_args =
            mpl_token_metadata::instructions::UpdateAsUpdateAuthorityV2InstructionArgs {
                new_update_authority: Some(new_authority),
                data: None,
                primary_sale_happened: None,
                is_mutable: None,
                collection: CollectionToggle::None,
                collection_details: CollectionDetailsToggle::None,
                uses: UsesToggle::None,
                rule_set: RuleSetToggle::None,
                token_standard: None,
                authorization_data: None,
            };

        let cpi = mpl_token_metadata::instructions::UpdateAsUpdateAuthorityV2Cpi::new(
            &ctx.token_metadata_program,
            cpi_accounts,
            update_authority_args,
        );

        cpi.invoke_signed(signers_seeds)?;

        Ok(())
    }
}
