//! Tests for the Role state

#[cfg(test)]
mod tests {

    use folio::utils::structs::Role;

    #[test]
    fn test_role_bits() {
        assert_eq!(Role::Owner as u8, 0b0000_0001);
        assert_eq!(Role::RebalanceManager as u8, 0b0000_0010);
        assert_eq!(Role::AuctionLauncher as u8, 0b0000_0100);
    }

    #[test]
    fn test_has_role() {
        let mut roles = 0u8;

        Role::add_role(&mut roles, Role::Owner);
        assert!(Role::has_role(roles, Role::Owner));
        assert!(!Role::has_role(roles, Role::RebalanceManager));
        assert!(!Role::has_role(roles, Role::AuctionLauncher));

        Role::add_role(&mut roles, Role::RebalanceManager);
        assert!(Role::has_role(roles, Role::Owner));
        assert!(Role::has_role(roles, Role::RebalanceManager));
        assert!(!Role::has_role(roles, Role::AuctionLauncher));
    }

    #[test]
    fn test_add_role() {
        let mut roles = 0u8;

        Role::add_role(&mut roles, Role::Owner);
        assert_eq!(roles, 0b0000_0001);

        Role::add_role(&mut roles, Role::RebalanceManager);
        assert_eq!(roles, 0b0000_0011);

        Role::add_role(&mut roles, Role::Owner);
        assert_eq!(roles, 0b0000_0011);

        Role::add_role(&mut roles, Role::AuctionLauncher);
        assert_eq!(roles, 0b0000_0111);
    }

    #[test]
    fn test_remove_role() {
        let mut roles = 0b0000_0111;

        Role::remove_role(&mut roles, Role::Owner);
        assert_eq!(roles, 0b0000_0110);
        assert!(!Role::has_role(roles, Role::Owner));
        assert!(Role::has_role(roles, Role::RebalanceManager));

        Role::remove_role(&mut roles, Role::RebalanceManager);
        assert_eq!(roles, 0b0000_0100);
        assert!(!Role::has_role(roles, Role::RebalanceManager));

        Role::remove_role(&mut roles, Role::Owner);
        assert_eq!(roles, 0b0000_0100);

        Role::remove_role(&mut roles, Role::AuctionLauncher);
        assert_eq!(roles, 0);
    }

    #[test]
    fn test_role_combinations() {
        let mut roles = 0u8;

        Role::add_role(&mut roles, Role::Owner);
        Role::add_role(&mut roles, Role::RebalanceManager);
        assert_eq!(roles, 0b0000_0011);
        assert!(Role::has_role(roles, Role::Owner));
        assert!(Role::has_role(roles, Role::RebalanceManager));

        Role::remove_role(&mut roles, Role::Owner);
        assert_eq!(roles, 0b0000_0010);
        assert!(!Role::has_role(roles, Role::Owner));
    }
}
