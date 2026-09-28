use crate::commands;
use crate::utils::output::Format;
use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "meetcal", version, about = "MeetCal CLI")]
pub struct Cli {
    #[command(subcommand)]
    pub command: Commands,

    /// Output format: table (default), json, or csv
    #[arg(long, global = true, value_enum, default_value_t = Format::Table)]
    pub format: Format,
}

#[derive(Subcommand)]
pub enum Commands {
    AdaptiveRecords(commands::adaptive_records::AdaptiveArgs),
    Attendance(commands::attendance::AttendanceArgs),
    ClubCompare(commands::club_compare::ClubCompareArgs),
    ClubResults(commands::club_results::ClubResultsArgs),
    ClubTrends(commands::group_trends::ClubTrendsArgs),
    ClubWrapped(commands::club_wrapped::ClubWrappedArgs),
    Clubs(commands::clubs::ClubsArgs),
    Compare(commands::compare::CompareArgs),
    H2h(commands::h2h::H2hArgs),
    IntlRankings(commands::intl_rankings::IntlRankingsArgs),
    Leaderboard(commands::leaderboard::LeaderboardArgs),
    Meet(commands::meet::MeetArgs),
    MeetInfo(commands::meet_info::MeetInfoArgs),
    MeetResults(commands::meet_results::MeetResultsArgs),
    Meets(commands::meets::MeetsArgs),
    NatRankings(commands::nat_rankings::NatRankingsArgs),
    NatRankingYear(commands::nat_ranking_year::NatRankingsYearArgs),
    Progress(commands::progress::ProgressArgs),
    QualifyingTotals(commands::qual_totals::QualTotalsArgs),
    Qualify(commands::qualify::QualifyArgs),
    Records(commands::records::RecordsArgs),
    Results(commands::results::ResultsArgs),
    Schedule(commands::schedule::ScheduleArgs),
    Search(commands::search::SearchArgs),
    Standards(commands::standards::StandardsArgs),
    Wrapped(commands::wrapped::WrappedArgs),
    Wso(commands::wso_results::WsoResultsArgs),
    WsoCompare(commands::wso_compare::WsoCompareArgs),
    WsoRecords(commands::wso_records::WsoRecordsArgs),
    WsoTrends(commands::group_trends::WsoTrendsArgs),
    WsoWrapped(commands::wso_wrapped::WsoWrappedArgs),
    Wsos(commands::wsos::WsosArgs),
}
