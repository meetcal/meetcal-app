use crate::commands;
use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "meetcal", version = "2.0.1", about = "MeetCal CLI")]
pub struct Cli {
    #[command(subcommand)]
    pub command: Commands,
}

#[derive(Subcommand)]
pub enum Commands {
    AdaptiveRecords(commands::adaptive_records::AdaptiveArgs),
    ClubCompare(commands::club_compare::ClubCompareArgs),
    ClubResults(commands::club_results::ClubResultsArgs),
    ClubWrapped(commands::club_wrapped::ClubWrappedArgs),
    Compare(commands::compare::CompareArgs),
    IntlRankings(commands::intl_rankings::IntlRankingsArgs),
    Meet(commands::meet::MeetArgs),
    MeetResults(commands::meet_results::MeetResultsArgs),
    NatRankings(commands::nat_rankings::NatRankingsArgs),
    NatRankingYear(commands::nat_ranking_year::NatRankingsYearArgs),
    QualifyingTotals(commands::qual_totals::QualTotalsArgs),
    Records(commands::records::RecordsArgs),
    Search(commands::search::SearchArgs),
    Standards(commands::standards::StandardsArgs),
    Wrapped(commands::wrapped::WrappedArgs),
    Wso(commands::wso_results::WsoResultsArgs),
    WsoCompare(commands::wso_compare::WsoCompareArgs),
    WsoRecords(commands::wso_records::WsoRecordsArgs),
    WsoWrapped(commands::wso_wrapped::WsoWrappedArgs),
}
