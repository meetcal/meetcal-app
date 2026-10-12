use clap::{CommandFactory, Parser};
use meetcal::parser::Cli;

fn help_for(command: &str) -> String {
    let matches = Cli::command()
        .try_get_matches_from_mut(["meetcal", command, "--help"])
        .unwrap_err();

    matches.to_string()
}

#[test]
fn records_help_lists_every_age_family_and_federation() {
    let help = help_for("records");

    for value in [
        "U13",
        "U15",
        "U17",
        "U20",
        "U23",
        "Youth",
        "Junior",
        "University",
        "Senior",
        "Masters 30",
        "Masters 35",
        "Masters 40",
        "Masters 45",
        "Masters 50",
        "Masters 55",
        "Masters 60",
        "Masters 65",
        "Masters 70",
        "Masters 75",
        "Masters 80",
        "Masters 85",
        "Masters 90",
        "BWL",
        "IWF",
        "UMWF",
        "USAMW",
        "USAW",
    ] {
        assert!(help.contains(value), "records help omitted {value}");
    }
}

#[test]
fn command_specific_age_help_matches_supported_families() {
    let standards = help_for("standards");
    assert!(standards.contains("U15, Youth, Junior, or Senior"));

    let international = help_for("intl-rankings");
    assert!(international.contains("U15, U17, Youth, Junior, University, or Senior"));

    let qualifying = help_for("qualifying-totals");
    for value in [
        "U11",
        "U25",
        "University",
        "Masters 35",
        "Masters 40",
        "Masters 45",
        "Masters 50",
        "Masters 55",
        "Masters 60",
        "Masters 65",
        "Masters 70",
        "Masters 75",
        "Masters 80",
        "Masters 85",
        "Masters 90",
    ] {
        assert!(
            qualifying.contains(value),
            "qualifying-totals help omitted {value}"
        );
    }

    let wso = help_for("wso-records");
    for value in [
        "U11",
        "Youth",
        "Masters 35",
        "Masters 40",
        "Masters 45",
        "Masters 50",
        "Masters 55",
        "Masters 60",
        "Masters 65",
        "Masters 70",
        "Masters 75",
        "Masters 80",
        "Masters 85",
        "Masters 90",
    ] {
        assert!(wso.contains(value), "wso-records help omitted {value}");
    }
}

#[test]
fn national_rankings_help_only_advertises_supported_federations() {
    let help = help_for("nat-rankings");

    assert!(help.contains("Federation: USAW or USAMW"));
    assert!(!help.contains("IWF, USAW"));
    assert!(!help.contains("UMWF"));
}

#[test]
fn gender_help_lists_both_values() {
    for command in [
        "records",
        "standards",
        "qualifying-totals",
        "intl-rankings",
        "wso-records",
    ] {
        let help = help_for(command);
        assert!(
            help.contains("Gender: Men or Women"),
            "{command} help omitted gender values"
        );
    }

    let adaptive = help_for("adaptive-records");
    assert!(adaptive.contains("Gender: Men or Women"));
}

#[test]
fn version_is_the_crates() {
    assert_eq!(
        Cli::command().get_version(),
        Some(env!("CARGO_PKG_VERSION"))
    );
}

/// A help example's words, as a shell would split them: quotes group words, and a redirect or a
/// pipe ends the command.
fn shell_words(line: &str) -> Vec<String> {
    let mut words = Vec::new();
    let mut word = String::new();
    let mut quote: Option<char> = None;
    let mut in_word = false;
    for c in line.chars() {
        match (quote, c) {
            (Some(q), c) if c == q => quote = None,
            (Some(_), c) => word.push(c),
            (None, '"' | '\'') => {
                quote = Some(c);
                in_word = true;
            }
            (None, c) if c.is_whitespace() => {
                if in_word {
                    words.push(std::mem::take(&mut word));
                    in_word = false;
                }
            }
            (None, '>' | '|') => break,
            (None, c) => {
                word.push(c);
                in_word = true;
            }
        }
    }
    assert!(quote.is_none(), "unclosed quote in example: {line}");
    if in_word {
        words.push(word);
    }
    words
}

/// Every subcommand's help examples, one command per line.
fn examples() -> Vec<(String, Vec<String>)> {
    Cli::command()
        .get_subcommands()
        .filter(|command| command.get_name() != "help")
        .map(|command| {
            let after = command
                .get_after_help()
                .map(|text| text.to_string())
                .unwrap_or_default();
            let lines = after
                .lines()
                .skip_while(|line| *line != "Examples:")
                .skip(1)
                .map(|line| line.trim().to_string())
                .filter(|line| !line.is_empty())
                .collect();
            (command.get_name().to_string(), lines)
        })
        .collect()
}

#[test]
fn every_command_lists_its_examples_one_per_line() {
    for (name, lines) in examples() {
        assert!(!lines.is_empty(), "{name} help has no examples");
        for line in &lines {
            assert!(
                line.starts_with(&format!("meetcal {name}")),
                "{name} example is not one command on its own line: {line}"
            );
            assert_eq!(
                line.matches("meetcal ").count(),
                1,
                "{name} examples are joined on one line: {line}"
            );
        }
        let help = help_for(&name);
        assert!(
            help.contains(&format!("Examples:\n  {}\n", lines[0])),
            "{name} --help does not print its first example on its own line"
        );
    }
}

#[test]
fn every_help_example_parses() {
    for (name, lines) in examples() {
        for line in lines {
            let words = shell_words(&line);
            if let Err(error) = Cli::try_parse_from(&words) {
                panic!("{name} example does not parse: {line}\n{error}");
            }
        }
    }
}

#[test]
fn shell_words_split_like_a_shell() {
    assert_eq!(
        shell_words(r#"meetcal meet "A, B" -s 1 --format csv > out.csv"#),
        ["meetcal", "meet", "A, B", "-s", "1", "--format", "csv"]
    );
    assert_eq!(
        shell_words(r#"meetcal nat-rankings "Junior Women's 77kg""#),
        ["meetcal", "nat-rankings", "Junior Women's 77kg"]
    );
}

#[test]
fn nat_ranking_year_help_names_itself_and_documents_year() {
    let help = help_for("nat-ranking-year");

    assert!(help.contains("one calendar year"));
    assert!(help.contains("meetcal nat-ranking-year \"Junior Women's 77kg\""));
    assert!(help.contains("Calendar year to rank"));
    assert!(!help.contains("meetcal nat-rankings \""));
    assert!(
        Cli::try_parse_from(["meetcal", "nat-ranking-year", "X", "-f", "USAW", "-y", "25"])
            .is_err()
    );
}

#[test]
fn adaptive_records_help_does_not_promise_a_weight_class() {
    assert!(!help_for("adaptive-records").contains("weight class"));
}
