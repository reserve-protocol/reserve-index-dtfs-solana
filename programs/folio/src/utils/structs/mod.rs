//! Structs for the Folio program. Often used within an account.
pub mod auction_end;
pub mod auction_status;
pub mod basket_range;
pub mod fee_recipient;
pub mod fixed_size_string;
pub mod folio_status;
pub mod prices;
pub mod roles;
pub mod token_amount;

pub use auction_end::*;
pub use auction_status::*;
pub use basket_range::*;
pub use fee_recipient::*;
pub use fixed_size_string::*;
pub use folio_status::*;
pub use prices::*;
pub use roles::*;
pub use token_amount::*;
