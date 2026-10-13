#!/usr/bin/env bash

set -euo pipefail

dist_dir="${TRUNK_STAGING_DIR:?Trunk must provide TRUNK_STAGING_DIR}"
shopt -s nullglob
javascript_candidates=("${dist_dir}"/meetcal-web-*.js)
wasm_candidates=("${dist_dir}"/meetcal-web-*_bg.wasm)

if [[ ${#javascript_candidates[@]} -ne 1 || ${#wasm_candidates[@]} -ne 1 ]]; then
  echo "Expected one MeetCal JavaScript loader and one Wasm binary in ${dist_dir}" >&2
  exit 1
fi

javascript_file="$(basename "${javascript_candidates[0]}")"
wasm_file="$(basename "${wasm_candidates[0]}")"

# The bootstrap loads the app and then removes index.html's loading shell
# (#app-loading). If the JavaScript loader or the Wasm binary can't load, it
# turns the shell into an error with a retry instead of leaving a blank page.
cat > "${dist_dir}/app-bootstrap.js" <<EOF
const shell = document.getElementById("app-loading");

function showLoadError() {
  if (!shell) return;
  shell.setAttribute("role", "alert");
  const message = shell.querySelector("[data-app-loading-message]");
  if (message) {
    message.className = "app-loading-error";
    message.textContent = "MeetCal couldn\u2019t load. Check your connection and try again.";
  }
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "app-loading-retry";
  retry.textContent = "Try again";
  retry.addEventListener("click", () => location.reload());
  shell.appendChild(retry);
}

try {
  const bindings = await import("/${javascript_file}");
  const wasm = await bindings.default({ module_or_path: "/${wasm_file}" });
  window.wasmBindings = bindings;
  shell?.remove();
  dispatchEvent(new CustomEvent("TrunkApplicationStarted", { detail: { wasm } }));
} catch (error) {
  console.error("MeetCal failed to load", error);
  showLoadError();
}
EOF

seo_dir="${dist_dir}/seo"
mkdir -p "${seo_dir}"

render_page() {
  local output_name="$1"
  local path="$2"
  local title="$3"
  local description="$4"
  local robots="$5"
  local canonical="https://meetcal.app${path}"

  PAGE_TITLE="${title}" \
  PAGE_DESCRIPTION="${description}" \
  PAGE_ROBOTS="${robots}" \
  PAGE_CANONICAL="${canonical}" \
    perl -0pe '
      s{<title>.*?</title>}{<title>$ENV{PAGE_TITLE}</title>}s;
      my %content = (
        "meta-description" => $ENV{PAGE_DESCRIPTION},
        "meta-robots" => $ENV{PAGE_ROBOTS},
        "meta-og-url" => $ENV{PAGE_CANONICAL},
        "meta-og-title" => $ENV{PAGE_TITLE},
        "meta-og-description" => $ENV{PAGE_DESCRIPTION},
        "meta-twitter-title" => $ENV{PAGE_TITLE},
        "meta-twitter-description" => $ENV{PAGE_DESCRIPTION},
      );
      for my $id (keys %content) {
        s{(<meta(?=[^>]*\bid="\Q$id\E")[^>]*\bcontent=")[^"]*(")}{$1$content{$id}$2}gs;
      }
      s{(<link(?=[^>]*\bid="canonical-url")[^>]*\bhref=")[^"]*(")}{$1$ENV{PAGE_CANONICAL}$2}gs;
    ' "${dist_dir}/index.html" > "${seo_dir}/${output_name}.html"
}

render_page "features" "/features" \
  "MeetCal Features — Schedules, Start Lists &amp; Rankings" \
  "See how MeetCal helps athletes, coaches, and fans navigate weightlifting schedules, start lists, rankings, reminders, and meet-day details." \
  "index, follow"
render_page "privacy" "/privacy" \
  "Privacy Policy — MeetCal" \
  "Learn how MeetCal collects, uses, shares, and protects information across its apps, website, and related services." \
  "index, follow"
render_page "terms" "/terms" \
  "Terms of Use — MeetCal" \
  "Read the terms that apply when using the MeetCal apps, website, competition data, and related services." \
  "index, follow"
render_page "subscription" "/subscription" \
  "Manage Your MeetCal Subscription in the App" \
  "Open MeetCal on iOS or Android to start, change, restore, or cancel your subscription." \
  "noindex, nofollow"

while IFS='|' read -r output_name path title; do
  render_page "${output_name}" "${path}" "${title}" \
    "Sign in with your MeetCal account to explore subscription competition data on the web." \
    "noindex, nofollow"
done <<'EOF'
comp-data|/comp-data|Competition Data
qualifying-totals|/qualifying-totals|Weightlifting Qualifying Totals
standards|/standards|Weightlifting Standards
results|/results|Athlete Competition Results
rankings|/rankings|International Weightlifting Rankings
national-rankings|/national-rankings|National Weightlifting Rankings
records|/records|Weightlifting Records
wso-records|/wso-records|USAW WSO Records
adaptive-records|/adaptive-records|Adaptive Weightlifting Records
meet-center|/meet-center|Weightlifting Meets, Schedules &amp; Results
club-dashboard|/club-dashboard|Weightlifting Club Meet Dashboard
wso-dashboard|/wso-dashboard|USAW WSO Meet Dashboard
wrapped|/wrapped|Weightlifting Athlete Wrapped
EOF
