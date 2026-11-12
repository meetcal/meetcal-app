use clap::Parser;
use meetcal::parser::{Cli, Commands};

#[test]
fn parses_meet_command() {
    let cli = Cli::parse_from(["meetcal", "meet", "2026 VIRUS Weightlifting Series 1"]);

    let Commands::Meet(args) = cli.command else {
        panic!("expected meet command");
    };

    assert_eq!(args.name, "2026 VIRUS Weightlifting Series 1");
}

#[test]
fn parses_meet_with_flags() {
    let cli = Cli::parse_from([
        "meetcal",
        "meet",
        "2026 VIRUS Weightlifting Series 1",
        "--session-number",
        "1",
        "--session-platform",
        "red",
    ]);

    let Commands::Meet(args) = cli.command else {
        panic!("expected meet command");
    };

    assert_eq!(args.name, "2026 VIRUS Weightlifting Series 1");
    assert_eq!(args.session_number, Some(1));
    assert_eq!(args.session_platform.as_deref(), Some("red"));
}

#[test]
fn takes_any_platform_name() {
    let cli = Cli::parse_from(["meetcal", "meet", "Meet", "--session-platform", "Gold"]);

    let Commands::Meet(args) = cli.command else {
        panic!("expected meet command");
    };

    assert_eq!(args.session_platform.as_deref(), Some("Gold"));
}

#[test]
fn a_session_number_that_is_not_a_whole_number_fails_on_its_option() {
    let error = Cli::try_parse_from(["meetcal", "meet", "Meet", "--session-number", "one"])
        .err()
        .expect("meet took --session-number one")
        .to_string();
    assert!(error.contains("--session-number"), "{error}");
}

#[test]
fn names_are_read_without_surrounding_space_and_must_not_be_blank() {
    let cli = Cli::parse_from(["meetcal", "meet", "  Ohio Open "]);
    let Commands::Meet(args) = cli.command else {
        panic!("expected meet command");
    };
    assert_eq!(args.name, "Ohio Open");

    let cli = Cli::parse_from(["meetcal", "wso", " Ohio Open", "--wso", "Carolina "]);
    let Commands::Wso(args) = cli.command else {
        panic!("expected wso command");
    };
    assert_eq!(
        (args.meet.as_str(), args.wso.as_str()),
        ("Ohio Open", "Carolina")
    );

    let cli = Cli::parse_from(["meetcal", "leaderboard", "--club", " Test Barbell "]);
    let Commands::Leaderboard(args) = cli.command else {
        panic!("expected leaderboard command");
    };
    assert_eq!(args.club.as_deref(), Some("Test Barbell"));

    for blank in [
        vec!["meetcal", "meet", "  "],
        vec!["meetcal", "search", ""],
        vec!["meetcal", "club-wrapped", " "],
        vec![
            "meetcal",
            "wso-records",
            "--age",
            "Senior",
            "--gender",
            "Men",
            "--wso",
            " ",
        ],
    ] {
        assert!(Cli::try_parse_from(&blank).is_err(), "{blank:?}");
    }
}

#[test]
fn every_gender_argument_reads_short_spellings_and_refuses_anything_else() {
    use meetcal::utils::stats::Gender;
    let cli = Cli::parse_from(["meetcal", "adaptive-records", "f"]);
    let Commands::AdaptiveRecords(args) = cli.command else {
        panic!("expected adaptive-records command");
    };
    assert_eq!(args.gender, Gender::Women);

    let cli = Cli::parse_from([
        "meetcal",
        "wso-records",
        "--age",
        "Senior",
        "--gender",
        "w",
        "--wso",
        "Carolina",
    ]);
    let Commands::WsoRecords(args) = cli.command else {
        panic!("expected wso-records command");
    };
    assert_eq!(args.gender, Gender::Women);

    let cli = Cli::parse_from(["meetcal", "leaderboard", "--gender", "male"]);
    let Commands::Leaderboard(args) = cli.command else {
        panic!("expected leaderboard command");
    };
    assert_eq!(args.gender, Some(Gender::Men));

    for refused in [
        vec!["meetcal", "adaptive-records", "mne"],
        vec!["meetcal", "leaderboard", "--gender", "mne"],
        vec!["meetcal", "standards", "--age", "Senior", "--gender", "mne"],
        vec![
            "meetcal",
            "records",
            "--age",
            "Senior",
            "--gender",
            "x",
            "--federation",
            "USAW",
        ],
    ] {
        let error = Cli::try_parse_from(&refused)
            .err()
            .unwrap_or_else(|| panic!("{refused:?} was accepted"))
            .to_string();
        assert!(error.contains("expected Men or Women"), "{error}");
    }
}

#[test]
fn meet_results_checks_its_year_like_the_other_commands() {
    let cli = Cli::parse_from(["meetcal", "meet-results", "Meet", "--year", "2022"]);
    let Commands::MeetResults(args) = cli.command else {
        panic!("expected meet-results command");
    };
    assert_eq!(args.year, Some(2022));
    for year in ["-5", "22", "12345"] {
        assert!(
            Cli::try_parse_from(["meetcal", "meet-results", "Meet", "--year", year]).is_err(),
            "{year}"
        );
    }
}

#[test]
fn parses_meet_without_flags() {
    let cli = Cli::try_parse_from([
        "meetcal",
        "meet",
        "2026 VIRUS Weightlifting Series 1",
        "1",
        "red",
    ]);

    assert!(cli.is_err());
}
