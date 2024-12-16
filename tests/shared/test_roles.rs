#[cfg(test)]
mod tests {
    use anchor_lang::prelude::*;
    use shared::structs::{
        FeeRecipientData, OwnerData, PriceCuratorData, Role, RoleData, TradeApproverData,
    };

    #[test]
    fn test_role_bits() {
        assert_eq!(Role::Owner as u8, 0b0000_0001);
        assert_eq!(Role::FeeRecipient as u8, 0b0000_0010);
        assert_eq!(Role::TradeOwner as u8, 0b0000_0100);
        assert_eq!(Role::PriceCurator as u8, 0b0000_1000);
    }

    #[test]
    fn test_has_role() {
        let mut roles = 0u8;

        Role::add_role(&mut roles, Role::Owner);
        assert!(Role::has_role(roles, Role::Owner));
        assert!(!Role::has_role(roles, Role::FeeRecipient));
        assert!(!Role::has_role(roles, Role::TradeOwner));
        assert!(!Role::has_role(roles, Role::PriceCurator));

        Role::add_role(&mut roles, Role::FeeRecipient);
        assert!(Role::has_role(roles, Role::Owner));
        assert!(Role::has_role(roles, Role::FeeRecipient));
        assert!(!Role::has_role(roles, Role::TradeOwner));
        assert!(!Role::has_role(roles, Role::PriceCurator));
    }

    #[test]
    fn test_add_role() {
        let mut roles = 0u8;

        Role::add_role(&mut roles, Role::Owner);
        assert_eq!(roles, 0b0000_0001);

        Role::add_role(&mut roles, Role::FeeRecipient);
        assert_eq!(roles, 0b0000_0011);

        Role::add_role(&mut roles, Role::Owner);
        assert_eq!(roles, 0b0000_0011);

        Role::add_role(&mut roles, Role::TradeOwner);
        Role::add_role(&mut roles, Role::PriceCurator);
        assert_eq!(roles, 0b0000_1111);
    }

    #[test]
    fn test_remove_role() {
        let mut roles = 0b0000_1111;

        Role::remove_role(&mut roles, Role::Owner);
        assert_eq!(roles, 0b0000_1110);
        assert!(!Role::has_role(roles, Role::Owner));
        assert!(Role::has_role(roles, Role::FeeRecipient));

        Role::remove_role(&mut roles, Role::FeeRecipient);
        assert_eq!(roles, 0b0000_1100);
        assert!(!Role::has_role(roles, Role::FeeRecipient));

        Role::remove_role(&mut roles, Role::Owner);
        assert_eq!(roles, 0b0000_1100);

        Role::remove_role(&mut roles, Role::TradeOwner);
        Role::remove_role(&mut roles, Role::PriceCurator);
        assert_eq!(roles, 0);
    }

    #[test]
    fn test_role_combinations() {
        let mut roles = 0u8;

        Role::add_role(&mut roles, Role::Owner);
        Role::add_role(&mut roles, Role::FeeRecipient);
        assert_eq!(roles, 0b0000_0011);
        assert!(Role::has_role(roles, Role::Owner));
        assert!(Role::has_role(roles, Role::FeeRecipient));

        Role::remove_role(&mut roles, Role::Owner);
        assert_eq!(roles, 0b0000_0010);
        assert!(!Role::has_role(roles, Role::Owner));
        assert!(Role::has_role(roles, Role::FeeRecipient));
    }

    #[test]
    fn test_role_data_initialization() {
        let role_data = RoleData::default();

        assert_eq!(role_data.fee_recipient.fee_ratio, 0);

        let serialized = role_data.try_to_vec().unwrap();
        let deserialized = RoleData::try_from_slice(&serialized).unwrap();

        assert_eq!(
            role_data.fee_recipient.fee_ratio,
            deserialized.fee_recipient.fee_ratio
        );
    }
}
