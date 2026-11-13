use crate::components::{
    footer::Footer,
    header::Header,
    seo::RouteMetadata,
    subscription_gate::{MobileSubscriptionPage, SubscriptionGate},
};
use crate::pages::comp_data::catalog;
use crate::pages::{
    comp_data::{
        adaptive_records::AdaptiveRecords, club_dashboard::ClubDashboard, data_home::CompData,
        meet_center::MeetCenter, national_rankings::NationalRankings,
        qual_totals::QualifyingTotals, rankings::Rankings, records::Records, results::Results,
        standards::Standards, wrapped::Wrapped, wso_dashboard::WsoDashboard, wso_elite::WsoElite,
        wso_records::WsoRecords,
    },
    features::FeaturesPage,
    home::Home,
    link::LinkPage,
    not_found::NotFound,
    privacy::PrivacyPage,
    schedule_builder::ScheduleBuilderPage,
    submit_meet::SubmitMeetPage,
    terms::TermsPage,
};
use leptos::prelude::*;
use leptos_router::components::*;
use leptos_router::path;

#[component]
pub fn SiteRoutes(#[prop(default = true)] footer: bool) -> impl IntoView {
    view! {
        <Router>
            <RouteMetadata />
            <div class="site-shell">
            <Header />
            <main id="main-content">
                <Routes fallback=|| view! { <NotFound /> }>
                    <Route path=path!("/") view=Home />
                    <Route path=path!("/comp-data") view=|| view! { <SubscriptionGate page=catalog::DATA_HOME><CompData /></SubscriptionGate> } />
                    <Route path=path!("/qualifying-totals") view=|| view! { <SubscriptionGate page=catalog::QUALIFYING_TOTALS><QualifyingTotals /></SubscriptionGate> } />
                    <Route path=path!("/standards") view=|| view! { <SubscriptionGate page=catalog::STANDARDS><Standards /></SubscriptionGate> } />
                    <Route path=path!("/records") view=|| view! { <SubscriptionGate page=catalog::RECORDS><Records /></SubscriptionGate> } />
                    <Route path=path!("/results") view=|| view! { <SubscriptionGate page=catalog::RESULTS><Results /></SubscriptionGate> } />
                    <Route path=path!("/rankings") view=|| view! { <SubscriptionGate page=catalog::RANKINGS><Rankings /></SubscriptionGate> } />
                    <Route path=path!("/national-rankings") view=|| view! { <SubscriptionGate page=catalog::NATIONAL_RANKINGS><NationalRankings /></SubscriptionGate> } />
                    <Route path=path!("/wso-records") view=|| view! { <SubscriptionGate page=catalog::WSO_RECORDS><WsoRecords /></SubscriptionGate> } />
                    <Route path=path!("/adaptive-records") view=|| view! { <SubscriptionGate page=catalog::ADAPTIVE_RECORDS><AdaptiveRecords /></SubscriptionGate> } />
                    <Route path=path!("/meet-center") view=|| view! { <SubscriptionGate page=catalog::MEET_CENTER><MeetCenter /></SubscriptionGate> } />
                    <Route path=path!("/club-dashboard") view=|| view! { <SubscriptionGate page=catalog::CLUB_DASHBOARD><ClubDashboard /></SubscriptionGate> } />
                    <Route path=path!("/wso-dashboard") view=|| view! { <SubscriptionGate page=catalog::WSO_DASHBOARD><WsoDashboard /></SubscriptionGate> } />
                    <Route path=path!("/wso-elite") view=|| view! { <SubscriptionGate page=catalog::WSO_ELITE><WsoElite /></SubscriptionGate> } />
                    <Route path=path!("/wrapped") view=Wrapped />
                    <Route path=path!("/subscription") view=MobileSubscriptionPage />
                    <Route path=path!("/link") view=LinkPage />
                    <Route path=path!("/submit-meet") view=SubmitMeetPage />
                    <Route path=path!("/schedule-builder") view=ScheduleBuilderPage />
                    <Route path=path!("/features") view=FeaturesPage />
                    <Route path=path!("/privacy") view=PrivacyPage />
                    <Route path=path!("/terms") view=TermsPage />
                </Routes>
            </main>
            {footer.then(|| view! { <Footer /> })}
            </div>
        </Router>
    }
}
