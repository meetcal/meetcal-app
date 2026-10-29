use leptos::prelude::*;
use leptos_router::components::*;
use leptos_router::path;
use meetcal_web::pages::{
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
    submit_meet::SubmitMeetPage,
    terms::TermsPage,
};
use meetcal_web::{
    auth::provide_auth,
    components::{
        footer::Footer,
        header::Header,
        seo::RouteMetadata,
        subscription_gate::{MobileSubscriptionPage, SubscriptionGate, provide_access},
    },
};

fn main() {
    leptos::mount::mount_to_body(App)
}

#[component]
fn App() -> impl IntoView {
    provide_auth();
    provide_access();

    view! {
        <Router>
            <RouteMetadata />
            // One banner, one main, one contentinfo landmark for every page:
            // pages render only their content, inside <main> (#244).
            <div class="site-shell">
            <Header />
            <main id="main-content">
                <Routes fallback=|| view! { <NotFound /> }>
                    <Route path=path!("/") view=Home />
                    <Route path=path!("/comp-data") view=|| view! { <SubscriptionGate><CompData /></SubscriptionGate> } />
                    <Route path=path!("/qualifying-totals") view=|| view! { <SubscriptionGate><QualifyingTotals /></SubscriptionGate> } />
                    <Route path=path!("/standards") view=|| view! { <SubscriptionGate><Standards /></SubscriptionGate> } />
                    <Route path=path!("/records") view=|| view! { <SubscriptionGate><Records /></SubscriptionGate> } />
                    <Route path=path!("/results") view=|| view! { <SubscriptionGate><Results /></SubscriptionGate> } />
                    <Route path=path!("/rankings") view=|| view! { <SubscriptionGate><Rankings /></SubscriptionGate> } />
                    <Route path=path!("/national-rankings") view=|| view! { <SubscriptionGate><NationalRankings /></SubscriptionGate> } />
                    <Route path=path!("/wso-records") view=|| view! { <SubscriptionGate><WsoRecords /></SubscriptionGate> } />
                    <Route path=path!("/adaptive-records") view=|| view! { <SubscriptionGate><AdaptiveRecords /></SubscriptionGate> } />
                    <Route path=path!("/meet-center") view=|| view! { <SubscriptionGate><MeetCenter /></SubscriptionGate> } />
                    <Route path=path!("/club-dashboard") view=|| view! { <SubscriptionGate><ClubDashboard /></SubscriptionGate> } />
                    <Route path=path!("/wso-dashboard") view=|| view! { <SubscriptionGate><WsoDashboard /></SubscriptionGate> } />
                    <Route path=path!("/wso-elite") view=|| view! { <SubscriptionGate><WsoElite /></SubscriptionGate> } />
                    // Free for everyone, signed out included: a shared Wrapped opens for anyone.
                    <Route path=path!("/wrapped") view=Wrapped />
                    <Route path=path!("/subscription") view=MobileSubscriptionPage />
                    // Signed in, but no subscription needed: approves a `meetcal login`.
                    <Route path=path!("/link") view=LinkPage />
                    // Signed in, but no subscription needed: sends a meet's schedule and start lists.
                    <Route path=path!("/submit-meet") view=SubmitMeetPage />
                    <Route path=path!("/features") view=FeaturesPage />
                    <Route path=path!("/privacy") view=PrivacyPage />
                    <Route path=path!("/terms") view=TermsPage />
                </Routes>
            </main>
            <Footer />
            </div>
        </Router>
    }
}
