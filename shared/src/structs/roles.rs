use anchor_lang::prelude::*;

#[derive(Debug)]
pub enum Role {
    Owner = 0b0000_0001,
    FeeRecipient = 0b0000_0010,
    TradeOwner = 0b0000_0100,
    PriceCurator = 0b0000_1000,
}

#[derive(AnchorSerialize, AnchorDeserialize, Default, Clone, Copy, InitSpace)]
pub struct FeeRecipientData {
    pub fee_ratio: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Default, Clone, Copy, InitSpace)]
pub struct OwnerData {}

#[derive(AnchorSerialize, AnchorDeserialize, Default, Clone, Copy, InitSpace)]
pub struct TradeApproverData {}

#[derive(AnchorSerialize, AnchorDeserialize, Default, Clone, Copy, InitSpace)]
pub struct PriceCuratorData {}

#[derive(AnchorSerialize, AnchorDeserialize, Default, Clone, Copy, InitSpace)]
pub struct RoleData {
    pub fee_recipient: FeeRecipientData,
    pub owner: OwnerData,
    pub trade_approver: TradeApproverData,
    pub price_curator: PriceCuratorData,
}

impl Role {
    pub fn has_role(roles: u8, role: Role) -> bool {
        (roles & (role as u8)) != 0
    }

    pub fn add_role(roles: &mut u8, role: Role) {
        *roles |= role as u8;
    }

    pub fn remove_role(roles: &mut u8, role: Role) {
        *roles &= !(role as u8);
    }
}
