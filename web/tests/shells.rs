#![recursion_limit = "256"]

use leptos::prelude::*;
use leptos_router::location::RequestUrl;
use meetcal_web::app::SiteRoutes;
use meetcal_web::auth::{AuthContext, initial_auth_state, route_needs_sign_in};
use meetcal_web::components::seo::{PageMetadata, metadata_for_path, shell_paths};
use meetcal_web::components::subscription_gate::provide_access;
use std::path::PathBuf;

struct NothingRuns;

impl any_spawner::CustomExecutor for NothingRuns {
    fn spawn(&self, _: any_spawner::PinnedFuture<()>) {}
    fn spawn_local(&self, _: any_spawner::PinnedLocalFuture<()>) {}
    fn poll_local(&self) {}
}

const NOT_FOUND_PATH: &str = "/page-not-found";

fn first_frame(path: &str) -> String {
    let owner = Owner::new();
    owner.set();
    provide_context(RequestUrl::new(path));
    provide_context(AuthContext::prerendered(initial_auth_state(
        route_needs_sign_in(path),
    )));
    provide_access();
    let html = view! { <SiteRoutes footer=false /> }.to_html();
    drop(owner);
    html.replace("<!>", "").replace("<form ", "<form inert ")
}

fn stem(path: &str) -> &str {
    match path {
        "/" => "index",
        NOT_FOUND_PATH => "404",
        path => path.trim_start_matches('/'),
    }
}

fn escaped(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn route_line(path: &str, metadata: PageMetadata) -> String {
    let robots = if metadata.indexable {
        "index, follow"
    } else {
        "noindex, nofollow"
    };
    let canonical = if metadata.canonical { path } else { "" };
    format!(
        "{}|{}|{}|{}|{}\n",
        stem(path),
        canonical,
        escaped(metadata.title),
        escaped(metadata.description),
        robots
    )
}

fn expected_shells() -> Vec<(String, String)> {
    let _ = any_spawner::Executor::init_custom_executor(NothingRuns);
    let mut files = Vec::new();
    let mut routes = String::new();
    for path in shell_paths().chain([NOT_FOUND_PATH]) {
        routes.push_str(&route_line(path, metadata_for_path(path)));
        files.push((format!("{}.html", stem(path)), first_frame(path) + "\n"));
    }
    files.push(("routes.txt".to_owned(), routes));
    files
}

#[test]
fn the_committed_shells_are_the_first_frame_the_app_renders_on_each_route() {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("shells");
    let update = std::env::var_os("UPDATE_SHELLS").is_some();
    if update {
        std::fs::create_dir_all(&dir).unwrap();
    }
    let mut stale = Vec::new();
    for (name, contents) in expected_shells() {
        let file = dir.join(&name);
        if update {
            std::fs::write(&file, &contents).unwrap();
        } else if std::fs::read_to_string(&file).ok().as_deref() != Some(contents.as_str()) {
            stale.push(name);
        }
    }
    assert!(
        stale.is_empty(),
        "shells/ is out of date for {stale:?}: run UPDATE_SHELLS=1 cargo test --test shells"
    );
}

#[test]
fn every_route_shell_shows_its_own_heading() {
    for (name, contents) in expected_shells() {
        if name.ends_with(".html") {
            assert!(contents.contains("<h1"), "{name} has no heading");
            assert!(
                contents.contains("<header class=\"site-header\""),
                "{name} has no header"
            );
        }
    }
}
