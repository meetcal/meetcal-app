pub fn capitalize_first(text: &str) -> String {
    let mut characters = text.trim().chars();
    match characters.next() {
        Some(first) => first.to_uppercase().chain(characters).collect(),
        None => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_first_letter_is_capitalized() {
        assert_eq!(capitalize_first("gold"), "Gold");
        assert_eq!(capitalize_first("senior"), "Senior");
        assert_eq!(
            capitalize_first("meet name is required"),
            "Meet name is required"
        );
        assert_eq!(capitalize_first("  file too large "), "File too large");
        assert_eq!(capitalize_first("Already Capital"), "Already Capital");
        assert_eq!(capitalize_first("éclair"), "Éclair");
        assert_eq!(capitalize_first(""), "");
        assert_eq!(capitalize_first("   "), "");
    }
}
