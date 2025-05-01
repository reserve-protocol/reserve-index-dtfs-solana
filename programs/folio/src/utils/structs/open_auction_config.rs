use super::PricesInAuction;

#[derive(Default, Clone, Copy)]
/// For each auction run, we will store the start, end, and price.
pub struct OpenAuctionConfig {
    /// D18{buyToken/sellToken}
    pub price: PricesInAuction,

    /// D18{tok/share}
    pub sell_limit_spot: u128,

    /// D18{tok/share}
    pub buy_limit_spot: u128,
}
