#[cfg(test)]
mod tests {
    use crate::fixtures::fixtures::TestFixture;

    use super::*;
    use anchor_lang::{prelude::*, solana_program::bpf_loader_upgradeable};
    use folio::state::{Folio, ProgramRegistrar};
    use shared::errors::ErrorCode;
    use shared::{constants::PRECISION_FACTOR, structs::FeeRecipient};

    /*
    This is the only test done with accounts, because of the complexity of mocking / doing fixtures for accounts.
     */
    #[test]
    fn test_validate_folio_program_for_init() {
        let mut fixture = TestFixture::<ProgramRegistrar>::new();
        fixture.setup();

        let dtf_program = fixture.get_dtf_program().clone();

        let program_registrar = fixture.get_program_registrar_mut();
        program_registrar
            .add_to_registrar(&mut vec![dtf_program.key()])
            .unwrap();

        assert!(Folio::validate_folio_program_for_init(program_registrar, &dtf_program).is_ok());
    }
}
