use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Debug)]
pub enum Role {
    Owner = 0b0000_0001,
    TradeProposer = 0b0000_0010,
    PriceCurator = 0b0000_0100,
    BrandManager = 0b0000_1000,
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
