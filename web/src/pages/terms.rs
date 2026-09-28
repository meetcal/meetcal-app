use crate::components::{footer::Footer, header::Header};
use leptos::prelude::*;

#[component]
pub fn TermsPage() -> impl IntoView {
    view! {
        <Header />
        <TermsOfUse />
        <Footer />
    }
}

#[component]
pub fn TermsOfUse() -> impl IntoView {
    view! {
        <main>
            <div>
                <h1>
                    "Terms of Use"
                </h1>

                <div>
                    <p>
                        "Effective Date: August 23, 2026"
                    </p>

                    <h2>
                        "1. Acceptance of Terms"
                    </h2>

                    <p>
                        "By downloading or using the MeetCal apps, website, or related services, you agree to these Terms of Use. If you do not agree, please discontinue use of MeetCal."
                    </p>

                    <h2>
                        "2. Purpose of the App"
                    </h2>

                    <p>
                        "MeetCal is designed to provide a user-friendly way to view and manage national weightlifting meet schedules. The app does not provide live scoring, athlete registration, or real-time updates from federations."
                    </p>

                    <h2>
                        "3. User Responsibilities"
                    </h2>

                    <ul>
                        <li>
                            "You agree to use MeetCal solely for its intended purpose."
                        </li>
                        <li>
                            "You acknowledge that event information may change, and you should verify details with official sources."
                        </li>
                    </ul>

                    <h2>
                        "4. Data Collection"
                    </h2>

                    <p>
                        "MeetCal processes account, subscription, saved-session, preference, analytics, and support information as described in our "
                        <a
                            href="/privacy"
                        >
                            "Privacy Policy"
                        </a>
                        ". The Privacy Policy explains what is collected, why it is used, when it is shared with service providers, and the choices available to you."
                    </p>

                    <h2>
                        "5. Limitation of Liability"
                    </h2>

                    <p>
                        "We strive to provide accurate meet schedules, but we do not guarantee completeness or accuracy. We are not responsible for any scheduling conflicts, missed events, or reliance on information provided in the app."
                    </p>

                    <h2>
                        "6. Modifications to the App"
                    </h2>

                    <p>
                        "We may update or modify MeetCal without prior notice to improve functionality or add features."
                    </p>

                    <h2>
                        "7. Termination"
                    </h2>

                    <p>
                        "We reserve the right to terminate access to MeetCal at our discretion if misuse or abuse of the app occurs."
                    </p>

                    <h2>
                        "8. Contact Information"
                    </h2>

                    <p>
                        "For questions or concerns about these Terms of Use, contact us at "
                        <a
                            href="mailto:maddisen@meetcal.app"
                        >
                            "maddisen@meetcal.app"
                        </a>
                        "."
                    </p>

                    <p>
                        "By continuing to use MeetCal, you acknowledge and agree to these terms."
                    </p>
                </div>
            </div>
        </main>
    }
}
