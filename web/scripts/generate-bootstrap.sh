#!/usr/bin/env bash

set -euo pipefail

dist_dir="${TRUNK_STAGING_DIR:?Trunk must provide TRUNK_STAGING_DIR}"
shells_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../shells" && pwd)"
analytics_idle_timeout_ms=4000
shopt -s nullglob
javascript_candidates=("${dist_dir}"/meetcal-web-*.js)
wasm_candidates=("${dist_dir}"/meetcal-web-*_bg.wasm)
snippet_candidates=("${dist_dir}"/snippets/meetcal-web-*/src/*.js)

if [[ ${#javascript_candidates[@]} -ne 1 || ${#wasm_candidates[@]} -ne 1 || ${#snippet_candidates[@]} -eq 0 ]]; then
  echo "Expected one MeetCal JavaScript loader, one Wasm binary and its snippets in ${dist_dir}" >&2
  exit 1
fi

content_hash() {
  sha256sum | cut -c1-16
}

snippet_dir="$(dirname "$(dirname "${snippet_candidates[0]}")")"
snippet_crate="$(basename "${snippet_dir}")"
snippet_hash="$(cd "${snippet_dir}" && find . -type f -print | LC_ALL=C sort | xargs cat | content_hash)"
hashed_snippet_crate="${snippet_crate}-${snippet_hash}"
mv "${snippet_dir}" "${dist_dir}/snippets/${hashed_snippet_crate}"
sed -i "s#snippets/${snippet_crate}/#snippets/${hashed_snippet_crate}/#g" "${javascript_candidates[0]}"
javascript_file="meetcal-web-$(content_hash < "${javascript_candidates[0]}").js"
mv "${javascript_candidates[0]}" "${dist_dir}/${javascript_file}"

wasm_file="$(basename "${wasm_candidates[0]}")"
snippet_paths=""
for snippet in "${dist_dir}/snippets/${hashed_snippet_crate}"/src/*.js; do
  snippet_paths+="${snippet#"${dist_dir}"} "
done

cat > "${dist_dir}/app-bootstrap.js" <<EOF
const shell = document.getElementById("app-loading");
const prerendered = document.getElementById("app-prerendered");

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

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.addEventListener("load", resolve, { once: true });
    script.addEventListener("error", reject, { once: true });
    document.head.appendChild(script);
  });
}

function startAnalytics() {
  const whenIdle = window.requestIdleCallback ?? ((run) => setTimeout(run, 1));
  whenIdle(() => {
    loadScript("/posthog-env.js")
      .then(() => loadScript("/posthog-init.js"))
      .catch((error) => console.warn("Analytics did not load", error));
  }, { timeout: ${analytics_idle_timeout_ms} });
}

try {
  const bindings = await import("/${javascript_file}");
  const wasm = await bindings.default({ module_or_path: "/${wasm_file}" });
  window.wasmBindings = bindings;
  prerendered?.remove();
  shell?.remove();
  dispatchEvent(new CustomEvent("TrunkApplicationStarted", { detail: { wasm } }));
  startAnalytics();
} catch (error) {
  console.error("MeetCal failed to load", error);
  showLoadError();
}
EOF

bootstrap_hash="$(sha256sum "${dist_dir}/app-bootstrap.js" | cut -c1-16)"
bootstrap_file="app-bootstrap-${bootstrap_hash}.js"
mv "${dist_dir}/app-bootstrap.js" "${dist_dir}/${bootstrap_file}"

template="$(mktemp)"
trap 'rm -f "${template}"' EXIT
BOOTSTRAP_FILE="${bootstrap_file}" \
JAVASCRIPT_FILE="${javascript_file}" \
WASM_FILE="${wasm_file}" \
SNIPPET_PATHS="${snippet_paths}" \
  perl -0pe '
    my $preloads = join("\n    ",
      qq{<link rel="modulepreload" href="/$ENV{JAVASCRIPT_FILE}" />},
      (map { qq{<link rel="modulepreload" href="$_" />} } split(" ", $ENV{SNIPPET_PATHS})),
      qq{<link rel="preload" href="/$ENV{WASM_FILE}" as="fetch" type="application/wasm" crossorigin />},
    );
    s{<script type="module" src="/app-bootstrap\.js"></script>}{$preloads\n    <script type="module" src="/$ENV{BOOTSTRAP_FILE}"></script>}
      or die "index.html has no app-bootstrap.js script\n";
  ' "${dist_dir}/index.html" > "${template}"

seo_dir="${dist_dir}/seo"
mkdir -p "${seo_dir}"

render_page() {
  local stem="$1"
  local path="$2"
  local title="$3"
  local description="$4"
  local robots="$5"
  local output="$6"
  local canonical=""
  if [[ -n "${path}" ]]; then
    canonical="https://www.meetcal.app${path}"
  fi

  PAGE_TITLE="${title}" \
  PAGE_DESCRIPTION="${description}" \
  PAGE_ROBOTS="${robots}" \
  PAGE_CANONICAL="${canonical}" \
  PAGE_SHELL="${shells_dir}/${stem}.html" \
    perl -0pe '
      my $og_url = $ENV{PAGE_CANONICAL} ne "" ? $ENV{PAGE_CANONICAL} : "https://www.meetcal.app/";
      s{<title>.*?</title>}{<title>$ENV{PAGE_TITLE}</title>}s;
      my %content = (
        "meta-description" => $ENV{PAGE_DESCRIPTION},
        "meta-robots" => $ENV{PAGE_ROBOTS},
        "meta-og-url" => $og_url,
        "meta-og-title" => $ENV{PAGE_TITLE},
        "meta-og-description" => $ENV{PAGE_DESCRIPTION},
        "meta-twitter-title" => $ENV{PAGE_TITLE},
        "meta-twitter-description" => $ENV{PAGE_DESCRIPTION},
      );
      for my $id (keys %content) {
        s{(<meta(?=[^>]*\bid="\Q$id\E")[^>]*\bcontent=")[^"]*(")}{$1$content{$id}$2}gs;
      }
      if ($ENV{PAGE_CANONICAL} eq "") {
        s{\n[ \t]*<link(?=[^>]*\bid="canonical-url")[^>]*>}{}s;
      } else {
        s{(<link(?=[^>]*\bid="canonical-url")[^>]*\bhref=")[^"]*(")}{$1$ENV{PAGE_CANONICAL}$2}gs;
      }
      open(my $shell, "<:raw", $ENV{PAGE_SHELL}) or die "no shell for this route: $ENV{PAGE_SHELL}\n";
      my $page = do { local $/; <$shell> };
      $page =~ s{\s+\z}{};
      s{<div id="app-prerendered"></div>}{<div id="app-prerendered" class="app-prerendered">$page</div>}
        or die "index.html has no #app-prerendered placeholder\n";
    ' "${template}" > "${output}"
}

while IFS='|' read -r stem path title description robots; do
  case "${stem}" in
    index) output="${dist_dir}/index.html" ;;
    404) output="${dist_dir}/404.html" ;;
    *) output="${seo_dir}/${stem}.html" ;;
  esac
  render_page "${stem}" "${path}" "${title}" "${description}" "${robots}" "${output}"
done < "${shells_dir}/routes.txt"
