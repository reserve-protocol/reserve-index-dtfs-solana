use anchor_lang::prelude::*;
use spl_token_2022::{
    extension::{BaseStateWithExtensions, ExtensionType, StateWithExtensions},
    state::{Account, Mint},
};

/// Utility struct to do some verifications on the provided mints, make sure we don't have any extensions (spl-2022) that could break the folio.
/// They could break the folio program by requiring additional accounts when doing CPIs, which could lead to transaction size issues.
pub struct TokenUtil;

impl TokenUtil {
    /// The allowed mint extension types.
    /// `DefaultAccountState`, `PermanentDelegate`, `Pausable`, `ConfidentialTransferMint` and `TransferHook` are required
    /// for stockx tokens, example: https://solscan.io/token/XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB#extensions
    ///
    /// In the frontend we will show a warning if any mints in the folio have these extensions.
    ///
    /// For `DefaultAccountState` and `TransferHook` extensions, we validate their current configuration
    /// while acknowledging that these configs may change over time. We ensure the configuration is
    /// correct at the moment our smart contract interacts with these tokens.
    ///
    /// If the config change, we the DTF creator/owner must remove the tokens/take necessary actions.
    pub const ALLOWED_MINT_EXTENSION_TYPES: [ExtensionType; 13] = [
        ExtensionType::Uninitialized,
        ExtensionType::InterestBearingConfig,
        ExtensionType::MetadataPointer,
        ExtensionType::TokenMetadata,
        ExtensionType::TokenGroup,
        ExtensionType::TokenGroupMember,
        ExtensionType::GroupPointer,
        ExtensionType::ScaledUiAmount,
        // Only if the default state is `Initialized`
        ExtensionType::DefaultAccountState,
        ExtensionType::PermanentDelegate,
        ExtensionType::Pausable,
        ExtensionType::ConfidentialTransferMint,
        // Only if the program_id is None.
        ExtensionType::TransferHook,
    ];

    /// The allowed token extension types.
    pub const ALLOWED_TOKEN_EXTENSION_TYPES: [ExtensionType; 5] = [
        ExtensionType::Uninitialized,
        ExtensionType::ImmutableOwner,
        ExtensionType::ConfidentialTransferAccount,
        ExtensionType::TransferHookAccount,
        ExtensionType::PausableAccount,
    ];

    /// Check if the mint has any extensions.
    ///
    /// # Arguments
    /// * `mint_account_info` - The mint account info.
    ///
    /// Returns true if mint has any extensions that are not allowed, false otherwise.
    #[cfg(not(tarpaulin_include))]
    fn mint_has_extensions(mint_account_info: &AccountInfo) -> Result<bool> {
        let mint_data = mint_account_info.data.borrow();

        let mint_with_extensions = StateWithExtensions::<Mint>::unpack(&mint_data)?;

        let mint_extension_types = mint_with_extensions.get_extension_types()?;
        let all_extensions_are_allowed = mint_extension_types.iter().all(|extension_type| {
            TokenUtil::ALLOWED_MINT_EXTENSION_TYPES.contains(extension_type)
                && match extension_type {
                    ExtensionType::DefaultAccountState => {
                        use spl_token_2022::extension::default_account_state::DefaultAccountState;
                        use spl_token_2022::state::AccountState;

                        if let Ok(extension_config) =
                            mint_with_extensions.get_extension::<DefaultAccountState>()
                        {
                            extension_config.state == AccountState::Initialized as u8
                        } else {
                            false
                        }
                    }
                    ExtensionType::TransferHook => {
                        use spl_token_2022::extension::transfer_hook::TransferHook;

                        if let Ok(transfer_hook_extension) =
                            mint_with_extensions.get_extension::<TransferHook>()
                        {
                            let program_id: Option<Pubkey> =
                                transfer_hook_extension.program_id.into();
                            program_id.is_none()
                        } else {
                            false
                        }
                    }
                    _ => true,
                }
        });
        Ok(!all_extensions_are_allowed)
    }

    /// Check if the token has any extensions.
    ///
    /// # Arguments
    /// * `token_account_info` - The token account info.
    ///
    /// Returns true if token has any extensions that are not allowed, false otherwise.
    #[cfg(not(tarpaulin_include))]
    fn token_has_extensions(token_account_info: &AccountInfo) -> Result<bool> {
        let token_data = token_account_info.data.borrow();
        let token_with_extensions = StateWithExtensions::<Account>::unpack(&token_data)?;
        let token_extension_types = token_with_extensions.get_extension_types()?;

        let all_extensions_are_allowed = token_extension_types.iter().all(|extension_type| {
            TokenUtil::ALLOWED_TOKEN_EXTENSION_TYPES.contains(extension_type)
        });

        Ok(!all_extensions_are_allowed)
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
