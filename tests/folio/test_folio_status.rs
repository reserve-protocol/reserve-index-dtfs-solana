//! Tests for the FolioStatus enum

#[cfg(test)]
mod tests {
    use folio::utils::FolioStatus;

    #[test]
    fn test_folio_status_default() {
        let status = FolioStatus::default();
        assert_eq!(status, FolioStatus::Initializing);
    }

    #[test]
    fn test_folio_status_from_u8() {
        assert_eq!(FolioStatus::from(0), FolioStatus::Initializing);
        assert_eq!(FolioStatus::from(1), FolioStatus::Initialized);
        assert_eq!(FolioStatus::from(2), FolioStatus::Killed);
        assert_eq!(FolioStatus::from(3), FolioStatus::Migrating);
    }

    #[test]
    #[should_panic(expected = "Invalid enum value")]
    fn test_folio_status_from_invalid_u8() {
        let _ = FolioStatus::from(4);
    }

    #[test]
    fn test_folio_status_try_from() {
        assert_eq!(FolioStatus::try_from(0), Some(FolioStatus::Initializing));
        assert_eq!(FolioStatus::try_from(1), Some(FolioStatus::Initialized));
        assert_eq!(FolioStatus::try_from(2), Some(FolioStatus::Killed));
        assert_eq!(FolioStatus::try_from(3), Some(FolioStatus::Migrating));
        assert_eq!(FolioStatus::try_from(4), None);
        assert_eq!(FolioStatus::try_from(255), None);
    }

    #[test]
    fn test_folio_status_equality() {
        assert_eq!(FolioStatus::Initializing, FolioStatus::Initializing);
        assert_ne!(FolioStatus::Initializing, FolioStatus::Initialized);
        assert_ne!(FolioStatus::Initializing, FolioStatus::Killed);
        assert_ne!(FolioStatus::Initializing, FolioStatus::Migrating);
    }

    #[test]
    fn test_folio_status_copy() {
        let status = FolioStatus::Initialized;
        let copied = status;
        assert_eq!(status, copied);
    }

    #[test]
    fn test_folio_status_clone() {
        let status = FolioStatus::Killed;
        let cloned = status;
        assert_eq!(status, cloned);
    }

    #[test]
    fn test_folio_status_debug() {
        assert_eq!(format!("{:?}", FolioStatus::Initializing), "Initializing");
        assert_eq!(format!("{:?}", FolioStatus::Initialized), "Initialized");
        assert_eq!(format!("{:?}", FolioStatus::Killed), "Killed");
        assert_eq!(format!("{:?}", FolioStatus::Migrating), "Migrating");
    }
}
