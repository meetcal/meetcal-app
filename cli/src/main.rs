use anyhow::Result;
use clap::Parser;
use meetcal::commands;
use meetcal::parser::{Cli, Commands};

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Commands::AdaptiveRecords(args) => commands::adaptive_records::run(args).await?,
        Commands::ClubCompare(args) => commands::club_compare::run(args).await?,
        Commands::ClubResults(args) => commands::club_results::run(args).await?,
        Commands::ClubWrapped(args) => commands::club_wrapped::run(args).await?,
        Commands::Compare(args) => commands::compare::run(args).await?,
        Commands::IntlRankings(args) => commands::intl_rankings::run(args).await?,
        Commands::Meet(args) => commands::meet::run(args).await?,
        Commands::MeetResults(args) => commands::meet_results::run(args).await?,
        Commands::NatRankings(args) => commands::nat_rankings::run(args).await?,
        Commands::NatRankingYear(args) => commands::nat_ranking_year::run(args).await?,
        Commands::QualifyingTotals(args) => commands::qual_totals::run(args).await?,
        Commands::Records(args) => commands::records::run(args).await?,
        Commands::Search(args) => commands::search::run(args).await?,
        Commands::Standards(args) => commands::standards::run(args).await?,
        Commands::Wrapped(args) => commands::wrapped::run(args).await?,
        Commands::Wso(args) => commands::wso_results::run(args).await?,
        Commands::WsoCompare(args) => commands::wso_compare::run(args).await?,
        Commands::WsoRecords(args) => commands::wso_records::run(args).await?,
        Commands::WsoWrapped(args) => commands::wso_wrapped::run(args).await?,
    }

    Ok(())
}
