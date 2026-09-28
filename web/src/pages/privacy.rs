use crate::components::{footer::Footer, header::Header};
use leptos::prelude::*;

#[component]
pub fn PrivacyPage() -> impl IntoView {
    view! {
        <Header />
        <PrivacyPolicy />
        <Footer />
    }
}

#[component]
pub fn PrivacyPolicy() -> impl IntoView {
    view! {
        <main>
            <div>
                <h1>"Privacy Policy"</h1>

                <div>
                    <p>"Effective Date: August 23, 2026"</p>

                    <h2>"1. Overview"</h2>

                    <p>
                        "This Privacy Policy explains how MeetCal LLC collects, uses, shares, and protects information when you use the MeetCal mobile apps, website, and related services."
                    </p>

                    <h2>"2. Information We Collect"</h2>

                    <p>"Depending on how you use MeetCal, we may collect:"</p>

                    <ul>
                        <li>"Account information, such as your name, email address, account identifier, and authentication metadata, through Clerk."</li>
                        <li>"Subscription information, such as product, entitlement status, renewal or expiration status, app-store platform, and transaction identifiers, through RevenueCat and Apple or Google. MeetCal does not receive your full payment-card number."</li>
                        <li>"Saved sessions, selected athletes, notes, and preferences that you choose to sync across devices."</li>
                        <li>"Usage and device information, such as pages viewed, interactions, browser or device type, operating system, approximate location derived from an IP address, and diagnostic events, through PostHog."</li>
                        <li>"Messages and other information you provide when contacting us for support or exercising a privacy right."</li>
                    </ul>

                    <p>"We and our analytics provider may use cookies, local storage, or similar technologies to maintain sessions, remember settings, measure usage, and understand product performance. MeetCal does not currently provide a separate analytics preference control on the website. Browser or device privacy controls may limit some storage or tracking, but they may not prevent all analytics collection and can affect some features."</p>

                    <h2>"3. How We Use Information"</h2>

                    <ul>
                        <li>"Provide meet schedules, competition data, saved-session syncing, and account features."</li>
                        <li>"Verify subscription access and restore purchases across supported devices."</li>
                        <li>"Operate, secure, troubleshoot, and improve MeetCal."</li>
                        <li>"Measure feature usage and understand service performance."</li>
                        <li>"Respond to support requests and send service-related communications."</li>
                        <li>"Comply with legal obligations and prevent fraud, abuse, or security incidents."</li>
                    </ul>

                    <h2>"4. Subscriptions and Payments"</h2>

                    <p>"New subscriptions and subscription changes are available only through the MeetCal mobile app. Apple App Store or Google Play processes the purchase, and RevenueCat helps MeetCal confirm the resulting entitlement. Cancellation, billing, refunds, and payment-method controls are governed by the applicable app store."</p>

                    <h2>"5. When We Share Information"</h2>

                    <p>"We do not sell personal information. We share information only as needed with service providers that operate MeetCal, including:"</p>

                    <ul>
                        <li>"Clerk, for authentication and account management."</li>
                        <li>"RevenueCat, Apple, and Google, for subscriptions, entitlements, and purchase restoration."</li>
                        <li>"PostHog, for product analytics and diagnostics."</li>
                        <li>"Hosting, database, and infrastructure providers used to deliver and protect the service."</li>
                    </ul>

                    <p>"We may also disclose information when required by law, to protect users or the service, in connection with a business transaction, or with your direction or consent. Providers process information under their own terms and privacy commitments."</p>

                    <h2>"6. Device Permissions"</h2>

                    <p>"If you choose to add an event to your device calendar, MeetCal requests the permission needed to complete that action. Calendar data is handled on your device unless a feature clearly tells you otherwise. You can change permissions in your device settings."</p>

                    <h2>"7. Retention"</h2>

                    <p>"We retain account, subscription, saved-session, preference, support, and analytics information only for as long as reasonably necessary to provide the service, meet legal or accounting obligations, resolve disputes, enforce agreements, and protect the service. Retention periods vary by data type and provider. We may retain de-identified or aggregated information that no longer identifies you."</p>

                    <h2>"8. Security"</h2>

                    <p>
                        "We use reasonable administrative, technical, and organizational safeguards designed to protect information. No online service can guarantee absolute security, so please use a strong account password and protect access to your devices and email account."
                    </p>

                    <h2>"9. Your Choices and Rights"</h2>

                    <p>"Depending on your location, you may have the right to request access to, correction of, deletion of, or a copy of your personal information, or to object to or restrict certain processing. You may also:"</p>

                    <ul>
                        <li>"Update available account information through the account profile."</li>
                        <li>"Use available browser or device privacy controls, understanding that they may not prevent every analytics event."</li>
                        <li>"Manage or cancel a subscription through the MeetCal app and the applicable app store."</li>
                        <li>"Contact us to request account or synced-data deletion."</li>
                    </ul>

                    <p>"We may need to verify your identity before completing a request. You may appeal a denied request by replying to our response."</p>

                    <h2>"10. Children’s Privacy"</h2>

                    <p>"MeetCal provides information about weightlifting events that may include youth athletes, but account and subscription features are not directed to children under 13. If you believe a child provided personal information without appropriate permission, contact us so we can review and delete it where required."</p>

                    <h2>"11. International Processing"</h2>

                    <p>"MeetCal and its providers may process information in the United States and other countries. Those locations may have different data-protection laws than your location."</p>

                    <h2>"12. Changes to This Policy"</h2>

                    <p>
                        "We may update this policy as MeetCal changes. We will post the revised policy with a new effective date and provide additional notice when required by law."
                    </p>

                    <h2>"13. Contact Us"</h2>

                    <p>
                        "For privacy questions or requests, contact MeetCal LLC at "
                        <a
                            href="mailto:maddisen@meetcal.app"
                        >
                            "maddisen@meetcal.app"
                        </a>
                        "."
                    </p>
                </div>
            </div>
        </main>
    }
}
