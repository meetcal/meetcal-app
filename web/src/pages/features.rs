use crate::components::{footer::Footer, header::Header};
use leptos::prelude::*;

#[component]
pub fn FeaturesPage() -> impl IntoView {
    view! {
        <Header />
        <main class="features-page">
            <section class="features-hero">
                <p class="features-eyebrow">"Meet day, without the PDF hunt"</p>
                <h1>"Everything you need before the bar is loaded"</h1>
                <p>
                    "MeetCal turns Olympic weightlifting meet schedules, start lists, rankings, and session details into a clean mobile experience for athletes, coaches, and fans."
                </p>
            </section>

            <section class="feature-grid" aria-label="MeetCal features">
                <article class="feature-card">
                    <span class="feature-number">"01"</span>
                    <h2>"Clean Schedule View"</h2>
                    <p>
                        "Browse USAW and USAMW meet sessions without digging through cluttered PDFs. See session times, platforms, and divisions in one organized view."
                    </p>
                </article>

                <article class="feature-card">
                    <span class="feature-number">"02"</span>
                    <h2>"Save Sessions & Warmups"</h2>
                    <p>
                        "Build a personal meet-day schedule, save warmups, and sync important sessions directly to your device calendar."
                    </p>
                </article>

                <article class="feature-card">
                    <span class="feature-number">"03"</span>
                    <h2>"Athlete Start Lists"</h2>
                    <p>
                        "Look up athletes, entry totals, PRs, and start-list details so coaches and spectators can get context at a glance."
                    </p>
                </article>

                <article class="feature-card">
                    <span class="feature-number">"04"</span>
                    <h2>"Smart Meet Filters"</h2>
                    <p>
                        "Filter sessions and start lists by weight class, platform, club, or other meet details to find the information that matters."
                    </p>
                </article>

                <article class="feature-card">
                    <span class="feature-number">"05"</span>
                    <h2>"Rankings & Records"</h2>
                    <p>
                        "Check national and international rankings and records alongside the schedule, keeping meet context close at hand."
                    </p>
                </article>

                <article class="feature-card">
                    <span class="feature-number">"06"</span>
                    <h2>"Works Across Devices"</h2>
                    <p>
                        "Use MeetCal on iOS and Android, keep saved sessions synced, and rely on offline-first caching when meet venues get spotty."
                    </p>
                </article>
            </section>

            <section class="features-band">
                <div>
                    <h2>"Built for real meet days"</h2>
                    <p>
                        "Build a clear plan for every athlete—from weigh-in and warmups to platform and session time—then keep the whole team’s schedule in one place."
                    </p>
                </div>
            </section>
        </main>
        <Footer />
    }
}
