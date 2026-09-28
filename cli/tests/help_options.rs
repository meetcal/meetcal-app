use clap::CommandFactory;
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
