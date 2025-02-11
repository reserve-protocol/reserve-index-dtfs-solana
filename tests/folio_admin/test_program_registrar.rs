#[cfg(test)]
mod tests {
    use anchor_lang::prelude::*;
    use folio_admin::state::ProgramRegistrar;
    use shared::errors::ErrorCode;

    fn setup_registrar() -> ProgramRegistrar {
        ProgramRegistrar::default()
    }

    #[test]
    fn test_add_to_registrar_success() {
        let mut registrar = setup_registrar();

        let program1 = Pubkey::new_unique();
        let program2 = Pubkey::new_unique();

        let mut programs = vec![program1, program2];

        assert!(registrar.add_to_registrar(&mut programs).is_ok());
        assert!(registrar.is_in_registrar(program1));
        assert!(registrar.is_in_registrar(program2));
    }

    #[test]
    fn test_add_to_registrar_too_many_programs() {
        let mut registrar = setup_registrar();
        let mut programs = Vec::new();

        for _ in 0..=ProgramRegistrar::MAX_ACCEPTED_PROGRAMS {
            programs.push(Pubkey::new_unique());
        }

        let result = registrar.add_to_registrar(&mut programs);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), error!(ErrorCode::InvalidProgramCount));
    }

    #[test]
    fn test_remove_from_registrar() {
        let mut registrar = setup_registrar();

        let program1 = Pubkey::new_unique();
        let program2 = Pubkey::new_unique();
        let mut programs = vec![program1, program2];

        registrar.add_to_registrar(&mut programs).unwrap();
        assert!(registrar.remove_from_registrar(vec![program1]).is_ok());
        assert!(!registrar.is_in_registrar(program1));
        assert!(registrar.is_in_registrar(program2));
    }

    #[test]
    fn test_is_in_registrar() {
        let mut registrar = setup_registrar();
        let program = Pubkey::new_unique();
        let mut programs = vec![program];

        assert!(!registrar.is_in_registrar(program));
        registrar.add_to_registrar(&mut programs).unwrap();
        assert!(registrar.is_in_registrar(program));
    }

    #[test]
    fn test_add_to_registrar_partial_fill() {
        let mut registrar = setup_registrar();
        let program1 = Pubkey::new_unique();
        let mut programs = vec![program1];

        assert!(registrar.add_to_registrar(&mut programs).is_ok());
        assert!(registrar.is_in_registrar(program1));
        assert_eq!(
            registrar
                .accepted_programs
                .iter()
                .filter(|&&pubkey| pubkey != Pubkey::default())
                .count(),
            1
        );
    }

    #[test]
    fn test_remove_nonexistent_program() {
        let mut registrar = setup_registrar();
        let program = Pubkey::new_unique();

        let result = registrar.remove_from_registrar(vec![program]);

        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err(),
            error!(ErrorCode::ProgramNotInRegistrar)
        );
    }
}
