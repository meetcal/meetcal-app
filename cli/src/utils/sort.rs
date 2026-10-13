//! Weight-class order, the same rule as the server's `weightClassKey` (`convex/lib/sort.ts`).

/// Sort key for a weight class: classes holding no whole number at all last (`Open`, `45.5`),
/// then numeric order, a number's `+` class after the bounded one. Trailing `kg`s and `+`s are
/// stripped first. Never fails: a class the data spells some new way sorts last instead.
pub fn weight_class_key(class: &str) -> (bool, i32, bool) {
    let mut weight = class;
    while let Some(rest) = weight.strip_suffix("kg") {
        weight = rest;
    }
    let is_plus = weight.ends_with('+');
    let weight = weight.trim_end_matches('+');
    // As the server's `/^[+-]?\d+$/`: an optional sign, then digits only.
    let digits = weight.strip_prefix(['+', '-']).unwrap_or(weight);
    if !digits.is_empty()
        && digits.bytes().all(|b| b.is_ascii_digit())
        && let Ok(number) = weight.parse::<i32>()
    {
        return (false, number, is_plus);
    }
    (true, 0, is_plus)
}

/// `items` in weight-class order; items of the same class keep their order.
pub fn sort_by_class<T, F>(mut items: Vec<T>, mut get_weight_class: F) -> Vec<T>
where
    F: FnMut(&T) -> &str,
{
    items.sort_by_key(|item| weight_class_key(get_weight_class(item)));
    items
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classes_sort_by_number_then_plus_then_text() {
        let classes = vec![
            "Open", "110+kg", "45.5", "+87kg", "60kg", "110kg", "48kg ", "48", "87+",
        ];
        assert_eq!(
            sort_by_class(classes, |class| class),
            [
                "48", "60kg", "+87kg", "87+", "110kg", "110+kg", "Open", "45.5", "48kg "
            ]
        );
    }

    #[test]
    fn odd_classes_do_not_panic() {
        assert_eq!(weight_class_key("Open"), (true, 0, false));
        assert_eq!(weight_class_key("45.5"), (true, 0, false));
        assert_eq!(weight_class_key("+87kg"), (false, 87, false));
        assert_eq!(weight_class_key("48KG"), (true, 0, false));
        assert_eq!(weight_class_key(""), (true, 0, false));
        assert_eq!(weight_class_key("+"), (true, 0, true));
        assert_eq!(weight_class_key("99999999999kg"), (true, 0, false));
    }
}
