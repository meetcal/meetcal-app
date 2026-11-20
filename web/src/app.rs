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

pub const SCHEDULE_BUILDER_PATH: &str = "/schedule-builder";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WasmApp {
    Site,
    ScheduleBuilder,
}

impl WasmApp {
    pub fn serving(path: &str) -> Self {
        if path == SCHEDULE_BUILDER_PATH {
            Self::ScheduleBuilder
        } else {
            Self::Site
        }
    }

    pub fn link_rel(self, href: &str) -> Option<&'static str> {
        let path = href.split(['?', '#']).next().unwrap_or_default();
        let leaves_this_app = path.starts_with('/') && Self::serving(path) != self;
        leaves_this_app.then_some("external")
    }
}

pub fn link_rel(href: &str) -> Option<&'static str> {
    use_context::<WasmApp>()
        .unwrap_or(WasmApp::Site)
        .link_rel(href)
}

#[component]
fn SiteFrame(footer: bool, children: Children) -> impl IntoView {
    view! {
        <Router>
            <RouteMetadata />
            <div class="site-shell">
            <Header />
            <main id="main-content">{children()}</main>
            {footer.then(|| view! { <Footer /> })}
            </div>
        </Router>
    }
}

#[component]
pub fn SiteRoutes(#[prop(default = true)] footer: bool) -> impl IntoView {
    provide_context(WasmApp::Site);
    view! {
        <SiteFrame footer>
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
                    <Route path=path!("/features") view=FeaturesPage />
                    <Route path=path!("/privacy") view=PrivacyPage />
                    <Route path=path!("/terms") view=TermsPage />
                </Routes>
        </SiteFrame>
    }
}

#[component]
pub fn ScheduleBuilderRoutes(#[prop(default = true)] footer: bool) -> impl IntoView {
    provide_context(WasmApp::ScheduleBuilder);
    view! {
        <SiteFrame footer>
            <Routes fallback=|| view! { <NotFound /> }>
                <Route path=path!("/schedule-builder") view=ScheduleBuilderPage />
            </Routes>
        </SiteFrame>
    }
}

#[component]
pub fn WasmAppRoutes(app: WasmApp, #[prop(default = true)] footer: bool) -> impl IntoView {
    match app {
        WasmApp::Site => view! { <SiteRoutes footer /> }.into_any(),
        WasmApp::ScheduleBuilder => view! { <ScheduleBuilderRoutes footer /> }.into_any(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_schedule_builder_path_is_served_by_its_own_app() {
        assert_eq!(
            WasmApp::serving("/schedule-builder"),
            WasmApp::ScheduleBuilder
        );
        for path in ["/", "/records", "/schedule-builder/extra", "/wrapped"] {
            assert_eq!(WasmApp::serving(path), WasmApp::Site, "{path}");
        }
    }

    #[test]
    fn a_link_into_the_other_app_loads_a_whole_page() {
        assert_eq!(
            WasmApp::Site.link_rel("/schedule-builder"),
            Some("external")
        );
        assert_eq!(
            WasmApp::Site.link_rel("/schedule-builder?meet=Open"),
            Some("external")
        );
        assert_eq!(WasmApp::Site.link_rel("/records"), None);
        assert_eq!(WasmApp::ScheduleBuilder.link_rel("/schedule-builder"), None);
        assert_eq!(
            WasmApp::ScheduleBuilder.link_rel("/schedule-builder?meet=Open"),
            None
        );
        assert_eq!(WasmApp::ScheduleBuilder.link_rel("/"), Some("external"));
        assert_eq!(
            WasmApp::ScheduleBuilder.link_rel("/privacy"),
            Some("external")
        );
        for app in [WasmApp::Site, WasmApp::ScheduleBuilder] {
            assert_eq!(app.link_rel("mailto:maddisen@meetcal.app"), None);
            assert_eq!(app.link_rel("https://atlas.meetcal.app/"), None);
        }
    }
}
