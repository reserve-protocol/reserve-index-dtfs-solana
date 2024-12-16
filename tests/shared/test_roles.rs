#[cfg(test)]
mod tests {
    use anchor_lang::prelude::*;
    use shared::structs::Role;

    #[test]
    fn test_role_bits() {
        assert_eq!(Role::Owner as u8, 0b0000_0001);
        assert_eq!(Role::TradeApprover as u8, 0b0000_0010);
        assert_eq!(Role::PriceCurator as u8, 0b0000_0100);
    }

    #[test]
    fn test_has_role() {
        let mut roles = 0u8;

        Role::add_role(&mut roles, Role::Owner);
        assert!(Role::has_role(roles, Role::Owner));
        assert!(!Role::has_role(roles, Role::TradeApprover));
        assert!(!Role::has_role(roles, Role::PriceCurator));

        Role::add_role(&mut roles, Role::TradeApprover);
        assert!(Role::has_role(roles, Role::Owner));
        assert!(Role::has_role(roles, Role::TradeApprover));
        assert!(!Role::has_role(roles, Role::PriceCurator));
    }

    #[test]
    fn test_add_role() {
        let mut roles = 0u8;

        Role::add_role(&mut roles, Role::Owner);
        assert_eq!(roles, 0b0000_0001);

        Role::add_role(&mut roles, Role::TradeApprover);
        assert_eq!(roles, 0b0000_0011);

        Role::add_role(&mut roles, Role::Owner);
        assert_eq!(roles, 0b0000_0011);

        Role::add_role(&mut roles, Role::PriceCurator);
        assert_eq!(roles, 0b0000_0111);
    }

    #[test]
    fn test_remove_role() {
        let mut roles = 0b0000_0111;

        Role::remove_role(&mut roles, Role::Owner);
        assert_eq!(roles, 0b0000_0110);
        assert!(!Role::has_role(roles, Role::Owner));
        assert!(Role::has_role(roles, Role::TradeApprover));

        Role::remove_role(&mut roles, Role::TradeApprover);
        assert_eq!(roles, 0b0000_0100);
        assert!(!Role::has_role(roles, Role::TradeApprover));

        Role::remove_role(&mut roles, Role::Owner);
        assert_eq!(roles, 0b0000_0100);

        Role::remove_role(&mut roles, Role::PriceCurator);
        assert_eq!(roles, 0);
    }

    #[test]
    fn test_role_combinations() {
        let mut roles = 0u8;

        Role::add_role(&mut roles, Role::Owner);
        Role::add_role(&mut roles, Role::TradeApprover);
        assert_eq!(roles, 0b0000_0011);
        assert!(Role::has_role(roles, Role::Owner));
        assert!(Role::has_role(roles, Role::TradeApprover));

        Role::remove_role(&mut roles, Role::Owner);
        assert_eq!(roles, 0b0000_0010);
        assert!(!Role::has_role(roles, Role::Owner));
    }
}
