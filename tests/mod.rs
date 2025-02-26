//! Test module for the folio program as well as the folio admin program.
//! The unit tests only cover tests that don't require an Account<>, AccountLoader<> or AccountInfo<> as parameters,
//! to make it simpler when trying to mock data. Those different functions will be tested in the integration tests indirectly.
pub mod folio;
pub mod folio_admin;
