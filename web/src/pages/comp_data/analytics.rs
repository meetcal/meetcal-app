/// `makes` over `attempts` as a percentage, 0–100; 0 with no attempts.
pub(crate) fn percentage(makes: usize, attempts: usize) -> f64 {
    if attempts == 0 {
        0.0
    } else {
        makes as f64 / attempts as f64 * 100.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percentages_are_out_of_a_hundred_and_zero_without_attempts() {
        assert_eq!(percentage(4, 5), 80.0);
        assert_eq!(percentage(0, 0), 0.0);
    }
}
