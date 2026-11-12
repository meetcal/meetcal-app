use std::cmp::Ordering;

pub(crate) fn filter_options<'a>(values: impl Iterator<Item = &'a str>) -> Vec<String> {
    let mut options = values
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .collect::<Vec<_>>();
    options.sort();
    options.dedup();
    options
}

pub(crate) fn weight_class_options<'a>(values: impl Iterator<Item = &'a str>) -> Vec<String> {
    let mut options = values
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .collect::<Vec<_>>();
    options.sort_by(|left, right| compare_weight_classes(left, right));
    options.dedup();
    options
}

pub(crate) fn compare_weight_classes(left: &str, right: &str) -> Ordering {
    let left_key = weight_class_key(left);
    let right_key = weight_class_key(right);

    match (left_key.0, right_key.0) {
        (Some(left_weight), Some(right_weight)) => left_weight
            .cmp(&right_weight)
            .then_with(|| left_key.1.cmp(&right_key.1))
            .then_with(|| left.cmp(right)),
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (None, None) => left.cmp(right),
    }
}

fn weight_class_key(value: &str) -> (Option<u32>, bool) {
    let digits = value
        .chars()
        .skip_while(|character| !character.is_ascii_digit())
        .take_while(char::is_ascii_digit)
        .collect::<String>();

    (digits.parse().ok(), value.contains('+'))
}

pub(crate) fn matches_filter(value: &str, selected: &str) -> bool {
    selected.is_empty() || value == selected
}

pub(crate) trait ClassifiedRow {
    fn gender(&self) -> &str;
    fn age_category(&self) -> &str;
    fn weight_class(&self) -> &str;
}

pub(crate) struct ClassificationFilters<'a> {
    pub gender: &'a str,
    pub age_category: &'a str,
    pub weight_class: &'a str,
}

pub(crate) fn classified_rows<'a, T, F>(
    rows: &'a [T],
    filters: &ClassificationFilters<'_>,
    include: F,
) -> Vec<&'a T>
where
    T: ClassifiedRow,
    F: Fn(&T) -> bool,
{
    rows.iter()
        .filter(|row| {
            matches_filter(row.gender(), filters.gender)
                && matches_filter(row.age_category(), filters.age_category)
                && matches_filter(row.weight_class(), filters.weight_class)
                && include(row)
        })
        .collect()
}

#[derive(Clone, Copy)]
pub(crate) enum SortDirection {
    Ascending,
    Descending,
}

pub(crate) fn sort_numeric<T, F>(rows: &mut [&T], value: F, direction: SortDirection)
where
    F: Fn(&T) -> f64,
{
    rows.sort_by(|left, right| {
        let ordering = value(left).total_cmp(&value(right));
        match direction {
            SortDirection::Ascending => ordering,
            SortDirection::Descending => ordering.reverse(),
        }
    });
}

pub(crate) fn sort_text<T, F>(rows: &mut [&T], value: F, direction: SortDirection)
where
    F: Fn(&T) -> &str,
{
    rows.sort_by(|left, right| {
        let ordering = value(left).cmp(value(right));
        match direction {
            SortDirection::Ascending => ordering,
            SortDirection::Descending => ordering.reverse(),
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestClassifiedRow {
        gender: &'static str,
        age: &'static str,
        weight: &'static str,
        active: bool,
    }

    impl ClassifiedRow for TestClassifiedRow {
        fn gender(&self) -> &str {
            self.gender
        }
        fn age_category(&self) -> &str {
            self.age
        }
        fn weight_class(&self) -> &str {
            self.weight
        }
    }

    #[test]
    fn filter_options_are_trimmed_sorted_unique_and_nonempty() {
        let options = filter_options(["  Women ", "Men", "", "Men", "   ", "Youth"].into_iter());

        assert_eq!(options, ["Men", "Women", "Youth"]);
    }

    #[test]
    fn weight_classes_sort_by_weight_with_open_classes_last() {
        let options = weight_class_options(
            ["110+kg", "32kg", "110kg", "63+kg", "30kg", "63kg", "32kg"].into_iter(),
        );

        assert_eq!(
            options,
            ["30kg", "32kg", "63kg", "63+kg", "110kg", "110+kg"]
        );
    }

    #[test]
    fn empty_selection_matches_everything() {
        assert!(matches_filter("Senior", ""));
        assert!(matches_filter("Senior", "Senior"));
        assert!(!matches_filter("Junior", "Senior"));
    }

    #[test]
    fn generic_classification_filter_combines_shared_and_page_rules() {
        let rows = [
            TestClassifiedRow {
                gender: "Women",
                age: "Senior",
                weight: "69kg",
                active: true,
            },
            TestClassifiedRow {
                gender: "Women",
                age: "Junior",
                weight: "69kg",
                active: true,
            },
            TestClassifiedRow {
                gender: "Women",
                age: "Senior",
                weight: "69kg",
                active: false,
            },
        ];
        let filters = ClassificationFilters {
            gender: "Women",
            age_category: "Senior",
            weight_class: "69kg",
        };

        let filtered = classified_rows(&rows, &filters, |row| row.active);

        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].age, "Senior");
    }

    #[test]
    fn generic_sort_helpers_handle_both_directions() {
        struct Row {
            name: &'static str,
            total: f64,
        }
        let rows = [
            Row {
                name: "Bravo",
                total: 200.0,
            },
            Row {
                name: "Alpha",
                total: 250.0,
            },
        ];
        let mut sorted = rows.iter().collect::<Vec<_>>();

        sort_numeric(&mut sorted, |row| row.total, SortDirection::Descending);
        assert_eq!(sorted[0].total, 250.0);

        sort_text(&mut sorted, |row| row.name, SortDirection::Ascending);
        assert_eq!(sorted[0].name, "Alpha");
    }
}
