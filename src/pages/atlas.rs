use crate::components::{footer::Footer, header::Header};
use leptos::prelude::*;

const ATLAS_WEB: &str = "https://atlas.meetcal.app";
const ATLAS_IOS: &str = "https://apps.apple.com/us/app/atlas-oly-training-journal/id6804845585";

#[component]
pub fn AtlasPage() -> impl IntoView {
    view! {
        <Header />
        <section class="hero-section atlas-hero" aria-labelledby="atlas-title">
            <p class="hero-eyebrow">"Atlas by MeetCal"</p>
            <h1 id="atlas-title">"Weightlifting programs and coaching"</h1>
            <p class="hero-copy">
                "Write programs for your athletes, review their training, and talk through their lifts. Atlas gives coaches a web console and athletes an app for their daily sessions."
            </p>
        </section>

        <section class="download-section" aria-labelledby="atlas-download-title">
            <div class="download-copy">
                <p class="section-eyebrow">"For coaches and athletes"</p>
                <h2 id="atlas-download-title">"Open Atlas on your device"</h2>
                <p>"Use the coach console in your browser, or download the iPhone app to see your program and log your training."</p>
            </div>
            <div class="store-links" aria-label="Open Atlas">
                <a class="store-link store-link-primary" href=ATLAS_WEB>"Open coach console"</a>
                <a class="store-link store-link-secondary" href=ATLAS_IOS>"Get the iOS app"</a>
            </div>
        </section>

        <section class="interaction-section" aria-labelledby="atlas-features-title">
            <div class="interaction-heading">
                <p class="section-eyebrow">"Inside Atlas"</p>
                <h2 id="atlas-features-title">"Manage your athletes’ training"</h2>
                <p>"Check what your athletes have done, what’s coming up, and who needs a new program."</p>
            </div>
            <div class="feature-grid atlas-feature-grid">
                <article class="feature-card">
                    <span class="feature-number">"01"</span>
                    <h3>"Build and assign programs"</h3>
                    <p>"Write training blocks for each athlete. Save programs as templates so you can use them again."</p>
                </article>
                <article class="feature-card">
                    <span class="feature-number">"02"</span>
                    <h3>"Log your training"</h3>
                    <p>"Open your session, record what you did, and look back at previous workouts in the app."</p>
                </article>
                <article class="feature-card">
                    <span class="feature-number">"03"</span>
                    <h3>"Review progress"</h3>
                    <p>"See training history, athlete check-ins, and personal records before planning the next block."</p>
                </article>
                <article class="feature-card">
                    <span class="feature-number">"04"</span>
                    <h3>"Talk through the lifts"</h3>
                    <p>"Send messages, share lift videos, and give feedback on technique in Atlas."</p>
                </article>
                <article class="feature-card">
                    <span class="feature-number">"05"</span>
                    <h3>"Plan for meet day"</h3>
                    <p>"Add upcoming meets to an athlete’s calendar and write out their planned attempts."</p>
                </article>
                <article class="feature-card">
                    <span class="feature-number">"06"</span>
                    <h3>"Check on your team"</h3>
                    <p>"See who needs more training scheduled, review check-in alerts, and check which meets are coming up."</p>
                </article>
            </div>
        </section>

        <section class="atlas-closing" aria-labelledby="atlas-closing-title">
            <p class="section-eyebrow">"Atlas by MeetCal"</p>
            <h2 id="atlas-closing-title">"Training with a coach on Atlas?"</h2>
            <p>"Athletes need an invitation from their coach. Once you’re invited, download the app and sign in."</p>
            <div class="store-links" aria-label="Get started with Atlas">
                <a class="store-link store-link-primary" href=ATLAS_WEB>"Open coach console"</a>
                <a class="store-link store-link-secondary" href=ATLAS_IOS>"Download for iOS"</a>
            </div>
        </section>
        <Footer />
    }
}
