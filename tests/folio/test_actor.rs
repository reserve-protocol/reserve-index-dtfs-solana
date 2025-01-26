#[cfg(test)]
mod tests {

    use anchor_lang::prelude::Pubkey;
    use folio::state::Actor;
    use shared::errors::ErrorCode;

    #[test]
    fn test_process_init_if_needed_new_account() {
        let mut actor = Actor::default();
        let authority = Pubkey::new_unique();
        let folio = Pubkey::new_unique();

        let result = actor.process_init_if_needed(0, 255, &authority, &folio);

        assert!(result.is_ok());
        assert_eq!(actor.bump, 255);
        assert_eq!(actor.authority, authority);
        assert_eq!(actor.folio, folio);
        assert_eq!(actor.roles, 0);
    }

    #[test]
    fn test_process_init_if_needed_existing_account_matching_bumps() {
        let mut actor = Actor::default();
        let authority = Pubkey::new_unique();
        let folio = Pubkey::new_unique();

        let result = actor.process_init_if_needed(255, 255, &authority, &folio);

        assert!(result.is_ok());
    }

    #[test]
    fn test_process_init_if_needed_mismatched_bumps() {
        let mut actor = Actor::default();
        let authority = Pubkey::new_unique();
        let folio = Pubkey::new_unique();

        let result = actor.process_init_if_needed(254, 255, &authority, &folio);

        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), ErrorCode::InvalidBump.into());
    }

    #[test]
    fn test_reset() {
        let mut actor = Actor {
            bump: 255,
            authority: Pubkey::new_unique(),
            folio: Pubkey::new_unique(),
            roles: 123,
        };

        actor.reset();

        assert_eq!(actor.roles, 0);
        assert_eq!(actor.authority, Pubkey::default());
        assert_eq!(actor.folio, Pubkey::default());
        assert_eq!(actor.bump, 255);
    }
}
