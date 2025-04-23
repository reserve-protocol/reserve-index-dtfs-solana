//! Tests for the FixedSizeString struct

#[cfg(test)]
mod tests {
    use folio::utils::{FixedSizeString, MAX_PADDED_STRING_LENGTH};

    #[test]
    fn test_fixed_size_string_new() {
        // Test normal string within limits
        let normal_str = "Hello, World!";
        let fixed = FixedSizeString::new(normal_str);
        assert_eq!(&fixed.value[..normal_str.len()], normal_str.as_bytes());
        assert_eq!(fixed.value[normal_str.len()], 0); // Check padding

        // Test empty string
        let empty = FixedSizeString::new("");
        assert_eq!(empty.value[0], 0);

        // Test string at max length
        let max_str = "a".repeat(MAX_PADDED_STRING_LENGTH);
        let max_fixed = FixedSizeString::new(&max_str);
        assert_eq!(&max_fixed.value[..], max_str.as_bytes());

        // Test string exceeding max length
        let long_str = "a".repeat(MAX_PADDED_STRING_LENGTH + 10);
        let truncated = FixedSizeString::new(&long_str);
        assert_eq!(
            &truncated.value[..MAX_PADDED_STRING_LENGTH],
            &long_str.as_bytes()[..MAX_PADDED_STRING_LENGTH]
        );
    }

    #[test]
    fn test_fixed_size_string_default() {
        let default = FixedSizeString::default();
        assert!(default.value.iter().all(|&x| x == 0));
        assert_eq!(default.value.len(), MAX_PADDED_STRING_LENGTH);
    }

    #[test]
    fn test_fixed_size_string_with_special_chars() {
        // Test with UTF-8 characters
        let utf8_str = "Hello 世界!";
        let fixed = FixedSizeString::new(utf8_str);
        assert_eq!(&fixed.value[..utf8_str.len()], utf8_str.as_bytes());

        // Test with special characters
        let special_chars = "!@#$%^&*()_+";
        let fixed = FixedSizeString::new(special_chars);
        assert_eq!(
            &fixed.value[..special_chars.len()],
            special_chars.as_bytes()
        );
    }

    #[test]
    fn test_fixed_size_string_clone() {
        let original = FixedSizeString::new("Test String");
        let cloned = original;
        assert_eq!(original.value, cloned.value);
    }
}
