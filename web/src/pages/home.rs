use crate::components::feature::FeatureSection;
use crate::components::{footer::Footer, header::Header};
use leptos::prelude::*;
use leptos_router::components::A;

#[component]
pub fn Home() -> impl IntoView {
    view! {
        <Header />
        <HeroSection />
        <DownloadSection />
        <InteractionSection />
        <BodySection />
        <ReviewsSection />
        <HighlightSection />
        <Footer />
    }
}

#[component]
pub fn HeroSection() -> impl IntoView {
    view! {
        <section class="hero-section" aria-labelledby="hero-title">
            <p class="hero-eyebrow">"Olympic weightlifting, organized"</p>
            <h1 id="hero-title">"Your Competition Schedule, Simplified"</h1>
            <p class="hero-copy">"MeetCal transforms complex Olympic weightlifting competition schedules into a clear experience for athletes, coaches, and spectators."</p>
        </section>
    }
}

#[component]
pub fn DownloadSection() -> impl IntoView {
    view! {
        <section class="download-section" aria-labelledby="download-title">
            <div class="download-copy">
                <p class="section-eyebrow">"MeetCal for mobile"</p>
                <h2 id="download-title">"Take meet day with you"</h2>
                <p>"Save sessions, follow your club, and be ready for anything"</p>
            </div>
            <div class="store-links" aria-label="Download the MeetCal mobile app">
                <a class="store-link store-link-primary" href="https://apps.apple.com/us/app/meetcal/id6741133286">
                    <span>"Download for iOS"</span>
                </a>
                <a class="store-link store-link-secondary" href="https://play.google.com/store/apps/details?id=com.memohnsen.meetcal">
                    <span>"Download for Android"</span>
                </a>
            </div>
        </section>
    }
}

#[component]
pub fn InteractionSection() -> impl IntoView {
    view! {
        <section class="interaction-section" aria-labelledby="interaction-title">
            <div class="interaction-heading">
                <p class="section-eyebrow">"MeetCal, your way"</p>
                <h2 id="interaction-title">"Three ways to interact with MeetCal"</h2>
                <p>"Use the experience that fits the moment—from the competition floor to deeper data exploration."</p>
            </div>

            <div class="interaction-grid">
                <article class="interaction-card">
                    <div class="interaction-card-number" aria-hidden="true">"01"</div>
                    <p class="interaction-label">"The app"</p>
                    <h3>"Stay ready on meet day"</h3>
                    <p>"Browse schedules, save sessions, and follow athletes or teams from your phone or tablet."</p>
                    <a class="interaction-link" href="https://apps.apple.com/us/app/meetcal/id6741133286">"Get the mobile app" <span aria-hidden="true">"→"</span></a>
                </article>

                <article class="interaction-card interaction-card-cli">
                    <div class="interaction-card-number" aria-hidden="true">"02"</div>
                    <p class="interaction-label">"The CLI"</p>
                    <h3>"Work directly with the data"</h3>
                    <p>"Search and explore the full MeetCal database from USAW and USAMW without leaving your terminal."</p>
                    <div class="cli-install-options">
                        <CopyCommand
                            label="Homebrew"
                            command="brew tap meetcal/tap && brew install meetcal"
                        />
                        <CopyCommand
                            label="Cargo"
                            command="cargo install --git https://github.com/meetcal/meetcal-cli.git meetcal"
                        />
                    </div>
                </article>

                <article class="interaction-card">
                    <div class="interaction-card-number" aria-hidden="true">"03"</div>
                    <p class="interaction-label">"The web"</p>
                    <h3>"Explore from any browser"</h3>
                    <p>"Look up qualifying totals, standards, results, rankings, and records with nothing to install."</p>
                    <A href="/comp-data" attr:class="interaction-link">"Explore competition data" <span aria-hidden="true">"→"</span></A>
                </article>
            </div>
        </section>
    }
}

#[component]
fn CopyCommand(label: &'static str, command: &'static str) -> impl IntoView {
    let (copied, set_copied) = signal(false);

    view! {
        <div class="cli-command">
            <span class="cli-command-label">{label}</span>
            <div class="cli-command-box">
                <code>{command}</code>
                <button
                    class="copy-command-button"
                    type="button"
                    aria-label=move || if copied.get() {
                        format!("{label} install command copied")
                    } else {
                        format!("Copy {label} install command")
                    }
                    on:click=move |_| {
                        let _ = leptos::web_sys::window()
                            .expect("window should be available")
                            .navigator()
                            .clipboard()
                            .write_text(command);

                        set_copied.set(true);
                        leptos::leptos_dom::helpers::set_timeout(
                            move || set_copied.set(false),
                            std::time::Duration::from_millis(1800),
                        );
                    }
                >
                    <svg
                        class=move || if copied.get() { "copy-icon is-hidden" } else { "copy-icon" }
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                    >
                        <rect x="9" y="9" width="11" height="11" rx="2"></rect>
                        <path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"></path>
                    </svg>
                    <svg
                        class=move || if copied.get() { "check-icon" } else { "check-icon is-hidden" }
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                    >
                        <path d="m5 12 4 4L19 6"></path>
                    </svg>
                </button>
            </div>
        </div>
    }
}

#[component]
pub fn BodySection() -> impl IntoView {
    view! {
        <h2>"Everything you need to stay on track"</h2>

        <FeatureSection title="Simple Schedule View" subtitle="Access your competition schedule instantly without opening a single PDF." />

        <FeatureSection title="Save to Calendar" subtitle="Save sessions within the app or to your calendar to always know where to be." />

        <FeatureSection title="Track Your Team" subtitle="Keep tabs on all your athletes and teams in one place." />

        <FeatureSection title="Smart Filtering" subtitle="Filter by weight class, platform, or club to find exactly what you need." />

        <FeatureSection title="Cross-Platform" subtitle="Available on both iOS and Android, supporting both mobile and tablets." />
    }
}

#[component]
pub fn ReviewsSection() -> impl IntoView {
    let reviews = [
        (
            "So useful for athlete and coach!",
            "This app really has it all and has gotten better with every update.",
            "pandora user music lover",
        ),
        (
            "This is going to be a lifesaver",
            "Athlete forget to tell you when they're lifting? Easy!",
            "briddreamr",
        ),
        (
            "Should be mandatory for all USAW coaches.",
            "As long as I have this app on my phone, I will set all my athletes up for incredible days.",
            "BrittanyRucker",
        ),
        (
            "Filling a much-needed gap in USAW's event experience",
            "Can't thank him enough for the ease this provides during national meets.",
            "Jacobpennerweightlifting",
        ),
    ];

    view! {
        <section class="reviews-section" aria-labelledby="reviews-heading">
            <p class="reviews-eyebrow">"App Store Reviews"</p>
            <h2 id="reviews-heading">"Trusted on meet day"</h2>
            <div class="review-grid">
                {reviews.iter().map(|(title, quote, author)| view! {
                    <figure class="review-card">
                        <div class="review-stars" aria-label="5 out of 5 stars">"5.0"</div>
                        <blockquote>"\"" {*quote} "\""</blockquote>
                        <figcaption>
                            <strong>{*title}</strong>
                            <span>{*author}</span>
                        </figcaption>
                    </figure>
                }).collect_view()}
            </div>
        </section>
    }
}

#[component]
pub fn HighlightSection() -> impl IntoView {
    let screenshots = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10"];

    view! {
        <section class="highlight-section">
            <div class="highlight-copy">
                <p class="highlight-eyebrow">"Built for meet day"</p>
                <h2>"Throw Out the PDFs"</h2>
                <p>"Experience MeetCal's intuitive interface designed for athletes, coaches, and spectators."</p>
            </div>
            <div
                class="screenshot-marquee"
                role="img"
                aria-label="A scrolling preview of MeetCal app screens"
            >
                <div class="screenshot-track">
                    <div class="screenshot-set">
                        {screenshots.iter().map(|screenshot| view! {
                            <img src=format!("/images/{screenshot}.png") alt="" />
                        }).collect_view()}
                    </div>
                    <div class="screenshot-set" aria-hidden="true">
                        {screenshots.iter().map(|screenshot| view! {
                            <img src=format!("/images/{screenshot}.png") alt="" />
                        }).collect_view()}
                    </div>
                </div>
            </div>
        </section>
    }
}
