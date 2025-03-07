use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022::{
    extension::{BaseStateWithExtensions, ExtensionType, StateWithExtensions},
    state::{Account, Mint},
};

/// Utility struct to do some verifications on the provided mints, make sure we don't have any extensions (spl-2022) that could break the folio.
/// They could break the folio program by requiring additional accounts when doing CPIs, which could lead to transaction size issues.
pub struct TokenUtil;

impl TokenUtil {
    /// The forbidden mint extension types.
    pub const FORBIDDEN_MINT_EXTENSION_TYPES: [ExtensionType; 3] = [
        ExtensionType::TransferHook,
        ExtensionType::ConfidentialTransferMint,
        ExtensionType::PermanentDelegate,
    ];

    /// The forbidden token extension types.
    pub const FORBIDDEN_TOKEN_EXTENSION_TYPES: [ExtensionType; 2] = [
        ExtensionType::TransferFeeConfig,
        ExtensionType::MemoTransfer,
    ];

    /// Check if the mint has any extensions.
    ///
    /// # Arguments
    /// * `mint_account_info` - The mint account info.
    ///
    /// Returns true if the mint has any forbidden extensions, false otherwise.
    #[cfg(not(tarpaulin_include))]
    fn mint_has_extensions(mint_account_info: &AccountInfo) -> Result<bool> {
        let mint_data = mint_account_info.data.borrow();

        let mint_with_extensions = StateWithExtensions::<Mint>::unpack(&mint_data)?;

        let mint_extension_types = mint_with_extensions.get_extension_types()?;

        Ok(TokenUtil::FORBIDDEN_MINT_EXTENSION_TYPES
            .iter()
            .any(|extension_type| mint_extension_types.contains(extension_type)))
    }

    /// Check if the token has any extensions.
    ///
    /// # Arguments
    /// * `token_account_info` - The token account info.
    ///
    /// Returns true if the token has any forbidden extensions, false otherwise.
    #[cfg(not(tarpaulin_include))]
    fn token_has_extensions(token_account_info: &AccountInfo) -> Result<bool> {
        let token_data = token_account_info.data.borrow();
        let token_with_extensions = StateWithExtensions::<Account>::unpack(&token_data)?;

        let token_extension_types = token_with_extensions.get_extension_types()?;

        Ok(TokenUtil::FORBIDDEN_TOKEN_EXTENSION_TYPES
            .iter()
            .any(|extension_type| token_extension_types.contains(extension_type)))
    }

    /// Check if the mint and token have forbidden extensions.
    ///
    /// # Arguments
    /// * `mint_account_info` - The mint account info.
    /// * `token_account_info` - The token account info.
    ///
    /// Returns true if the mint and token don't have forbidden extensions, false otherwise.
    #[cfg(not(tarpaulin_include))]
    pub fn is_supported_spl_token(
        mint_account_info: Option<&AccountInfo>,
        token_account_info: Option<&AccountInfo>,
    ) -> Result<bool> {
        let mint_has_extensions = if let Some(mint_account_info) = mint_account_info {
            TokenUtil::mint_has_extensions(mint_account_info)?
        } else {
            false
        };
        let token_has_extensions = if let Some(token_account_info) = token_account_info {
            TokenUtil::token_has_extensions(token_account_info)?
        } else {
            false
        };

        Ok(!mint_has_extensions && !token_has_extensions)
    }
}
