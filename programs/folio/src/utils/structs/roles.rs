use anchor_lang::prelude::*;

/// Roles for the Folios.
///
/// The roles are stored as a bitmask in a u8.
#[derive(AnchorSerialize, AnchorDeserialize, Debug)]
pub enum Role {
    /// The owner of the Folio.
    Owner = 0b0000_0001,
    /// The rebalance manager of the Folio.
    RebalanceManager = 0b0000_0010,
    /// The auction launcher of the Folio.
    AuctionLauncher = 0b0000_0100,
    /// The brand manager of the Folio.
    BrandManager = 0b0000_1000,
}

impl Role {
    /// Checks if the role is set in the bitmask.
    ///
    /// # Arguments
    /// * `roles`: The bitmask of roles.
    /// * `role`: The role to check.
    ///
    /// # Returns
    /// * `bool`: True if the role is set, false otherwise.
    pub fn has_role(roles: u8, role: Role) -> bool {
        (roles & (role as u8)) != 0
    }

    /// Adds a role to the bitmask.
    ///
    /// # Arguments
    /// * `roles`: The bitmask of roles.
    /// * `role`: The role to add.
    pub fn add_role(roles: &mut u8, role: Role) {
        *roles |= role as u8;
    }

    /// Removes a role from the bitmask.
    ///
    /// # Arguments
    /// * `roles`: The bitmask of roles.
    /// * `role`: The role to remove.
    pub fn remove_role(roles: &mut u8, role: Role) {
        *roles &= !(role as u8);
    }
}
