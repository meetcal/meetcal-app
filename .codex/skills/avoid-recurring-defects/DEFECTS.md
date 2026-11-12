# Recurring Defects

Each entry: what it looks like here, what to do instead, and a search that finds candidates. The searches use `rg`; run them from the repository root.

## One Rule Written Twice

**Looks like:** a second copy of a helper that already exists, written because the first was not searched for. Seen as six hand-written promise chains beside `createWriteChain`, the same stack header options in fifteen screens, one records table in two screens, `isRecord` under three names, the weight-class, gender and date helpers defined several times in `convex/`, capitalise and "no value" helpers repeated across website pages, and fetch routines and answer types duplicated across CLI commands.

**Do instead:** search by what the code does before writing it, and import what you find. When the existing one is too narrow, widen it and move its callers in the same pull request.

**Search:** `rg "export (const|function) (format|parse|sort|compare|normalize|chunk|is[A-Z])\w*" src convex`, then the same verbs in `web/src cli/src`; `rg "fn (format|parse|sort|normalize)_\w+" web/src cli/src`.

## A Client Re-Implements A Server Rule

**Looks like:** the website or CLI computing something Convex already answers: medals, PRs and make rates in a CLI command, a ranking or tie rule on a page. The copies drift, and the surfaces then disagree about the same athlete.

**Do instead:** put the rule in `convex/lib/`, answer it from a query, and have every surface show the answer (AGENTS.md, One Source Across Surfaces).

**Search:** arithmetic on lifts outside `convex/`: `rg "snatch|cj_best|make_rate|sinclair" web/src cli/src src --glob '!*test*' -l`.

## A Cast Where A Check Belongs

**Looks like:** data from outside the type system given a type without being checked: `as T` after `JSON.parse`, `as unknown as T` on a stored row, a scraper casting fetched JSON, `assertArray<T>` returning rows it never looked at, `#[serde(default)]` or an `Option` hiding a field the server always sends. The value is typed as valid and fails later, far from the read.

**Do instead:** treat API answers, scraped pages, AsyncStorage, SecureStore, URL parameters and deep links as `unknown`, and build the typed value field by field. A value that does not fit is "nothing stored" or an error naming the field, decided at the read.

**Search:** `rg "as unknown as|JSON\.parse\([^)]*\) as |\) as [A-Z]\w+(\[\])?;" src convex --glob '!*test*'`; `rg "serde\(default" web/src cli/src`.

## A Type That Says More Than Is True

**Looks like:** a wire type declaring a field non-null while its mapper handles null; one name with two meanings (`Platform` as a string and as an object, two `Meet` interfaces, `Gender` in two casings); a type named for a backend that is gone.

**Do instead:** make the type say what is known at that point. One definition per domain type; a screen's filter type gets its own name.

**Search:** `rg "^export (type|interface) (\w+)" src/types src/data/types -o --no-filename | sort | uniq -d`.

## A Module With Several Jobs

**Looks like:** a file past a thousand lines holding unrelated things: the offline store (six jobs), the API module (clock, cache, every fetcher), the website's `api.rs`, a route file that also defines its components and styles, a provider that runs a state machine.

**Do instead:** when a change adds a second job to a file, put it in its own module. Screens and pages orchestrate; policy lives in `src/lib/`, `convex/lib/`, or a module the page imports, where it can be tested without rendering.

**Search:** `git ls-files src convex web/src cli/src | grep -vE "test|_generated" | xargs wc -l | sort -rn | head -20`.

## A Read With No Bound

**Looks like:** a Convex query that reads or answers every row of a table that only grows (every completed meet, every registration for eight meets), a scraper run with no time budget so one slow source times out the rest, a loop over a roster doing one request per name.

**Do instead:** bound every read with an index range and a limit, say in the answer when it was cut (`truncated`), give a multi-source job a budget per source, and chunk name lists with a named size.

**Search:** `rg "\.collect\(\)" convex --glob '!*test*'`; `rg "Promise\.all\(" src convex --glob '!*test*'`.

## A Failure That Looks Like Success

**Looks like:** an error swallowed into an empty or partial answer: a dropped promise from `Linking.openURL`, a CLI command printing a partial table after one lookup failed, a load error shown as "no results", `catch(() => {})` on a write.

**Do instead:** decide what the user sees for each failure. A rejected promise is caught and reported; a partial answer says it is partial; "nothing found" and "could not load" are different states with different text.

**Search:** `rg "\.catch\(\(\) => (\{\}|undefined|null)\)|catch \{\s*\}" src convex --glob '!*test*'`; `rg "unwrap_or_default\(\)|\.ok\(\)\?" web/src cli/src`.

## State That Does Not Recover After A Failure

**Looks like:** a guard set before the work and never cleared when the work fails: a "requested" ref that blocks a retry after a failed fetch, a throttle kept after the call it throttles failed, a login marked collected before its token exists.

**Do instead:** set the guard when the work succeeds, or clear it in the failure path. Write the test that fails the first attempt and expects the second to run.

**Search:** read every `useRef`, in-flight map and throttle row your change touches, and follow its failure path.

## A Missing Value Shown As A Real One

**Looks like:** a null rendered as `0` (a bodyweight, an unset record), a raw stored value shown where a label belongs (`69`, `+110`, `Female`), a summary built from empty parts (" •  • ").

**Do instead:** format through the one formatter for that kind of value, which knows the "no value" text. Build joined text from the parts that exist.

**Search:** `rg "\?\? 0|\|\| 0|unwrap_or\(0" src/app src/components web/src/pages cli/src/commands`.

## A Decision Made From Text

**Looks like:** branching on an error message, a sort key or list key compared as a string with a wildcard default, a flag parsed differently by sibling commands.

**Do instead:** carry the decision in a type: an error class or status, an enum the compiler checks for exhaustiveness, one parser per argument used by every command.

**Search:** `rg "message\.(includes|contains)|\.to_string\(\)\.contains\(|_ =>" src web/src cli/src --glob '!*test*'`.

## Output Whose Shape Depends On The Data

**Looks like:** JSON or CSV whose keys change with a flag or with whether a section is empty, a query whose answer differs in shape from its sibling's.

**Do instead:** every key is always present; an empty section is an empty list. A change to an answer is checked against every reader (`src/lib/api/`, `web/src/utils/api.rs`, `cli/src/utils/backend.rs`, `plugins/ios-app-intents/MeetCalAPI.swift`) and against shipped builds.

**Search:** `rg "skip_serializing_if" cli/src web/src`.

## Dead Code Left Behind

**Looks like:** a re-export file with no importers, a field nothing reads (a result `id` that is always 0), public items only tests use, a comment describing code that was replaced.

**Do instead:** delete what the change orphans, in the same pull request.

**Search:** `entire graph neighbors --repo . --head --format agent --symbol <Name> --direction in` for each export you stop using; `rg "allow\(dead_code\)" web/src cli/src`.
