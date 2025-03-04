use anchor_lang::prelude::*;

/// Status of the Folio.
#[derive(
    AnchorSerialize, AnchorDeserialize, Default, Clone, Copy, PartialEq, Eq, Debug, InitSpace,
)]
pub enum FolioStatus {
    #[default]
    /// Folio hasn't minted the initial shares yet
    Initializing = 0,
    /// Folio has minted the initial shares
    Initialized = 1,
    /// Folio has been killed
    Killed = 2,
    /// Folio is migrating to a new program
    Migrating = 3,
}

impl From<u8> for FolioStatus {
    /// Converts a u8 to a FolioStatus.
    ///
    /// # Arguments
    /// * `value`: The u8 value to convert.
    ///
    /// # Returns
    /// * `FolioStatus`: The FolioStatus.
    fn from(value: u8) -> Self {
        match value {
            0 => FolioStatus::Initializing,
            1 => FolioStatus::Initialized,
            2 => FolioStatus::Killed,
            3 => FolioStatus::Migrating,
            _ => panic!("Invalid enum value"),
        }
    }
}

impl FolioStatus {
    /// Tries to convert a u8 to a FolioStatus.
    ///
    /// # Arguments
    /// * `value`: The u8 value to convert.
    ///
    /// # Returns
    /// * `Option<FolioStatus>`: The FolioStatus.
    pub fn try_from(value: u8) -> Option<Self> {
        match value {
            0 => Some(FolioStatus::Initializing),
            1 => Some(FolioStatus::Initialized),
            2 => Some(FolioStatus::Killed),
            3 => Some(FolioStatus::Migrating),
            _ => None,
        }
    }
}
