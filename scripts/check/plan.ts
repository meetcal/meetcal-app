/**
 * Which gate suites a branch needs, from the paths it changes (ported from the
 * Atlas repository's `check-plan.ts`). Kept as data so the selection tests
 * check the real commands, not a parallel mock gate.
 */
export const CHECK_SUITES = ['app', 'web', 'cli'] as const;
export type Suite = (typeof CHECK_SUITES)[number];
export type CheckPlan = { suites: Suite[]; reason: string };
export type CheckStep = { name: string; command: string[]; cwd?: string };

const allChecks = (reason: string): CheckPlan => ({ suites: [...CHECK_SUITES], reason });

/** The gate itself: changing it runs everything, so a broken selector cannot hide work. */
const gateFiles = /^(?:scripts\/check(?:-lock)?\.ts|scripts\/check\/.*|mise\.toml)$/;

/**
 * Everything the app's lint, typecheck and Jest read: its sources and tests,
 * native config and plugins, and the Convex backend (`convex-tests/` runs in
 * the same Jest, and `tsrs` covers `convex/`). The coverage-gap report the gate
 * runs lives under `.codex/`.
 */
const appRoots = /^(?:src|convex|convex-tests|widget|plugins|assets|targets|jest|patches|scripts)\//;
const appFiles =
  /^(?:package\.json|bun\.lock|bunfig\.toml|tsconfig\.json|babel\.config\.js|metro\.config\.js|app\.config\.js|fingerprint\.config\.js|eas\.json|\.easignore|\.env\.example|jest\.setup\.js|eslint\.config\.js|\.prettierrc\.js|\.codex\/skills\/review-code-performance-tests\/scripts\/.*)$/;

/**
 * Inputs no local gate reads: documentation, ignore rules, agent skills, device
 * flows (Maestro runs on a simulator, not in the gate) and CI workflows (they
 * run on GitHub).
 */
const unchecked = /^(?:\.gitignore|\.prettierignore|\.maestro\/.*|\.github\/.*|\.codex\/.*|\.claude\/.*|docs\/.*)$/;

export function planChecks(paths: readonly string[] | null, all = false): CheckPlan {
  if (all) return allChecks('Explicit full run');
  if (paths === null || paths.length === 0) return allChecks('No reliable change scope; run everything');
  const suites = new Set<Suite>();
  for (const path of paths) {
    if (/\.md$/i.test(path)) continue;
    if (gateFiles.test(path)) return allChecks(`The gate or its toolchain changed: ${path}`);
    // The website and the CLI read Convex over HTTP and test against answer
    // shapes written by hand, so a `convex/` change does not run their suites
    // (their CI still runs on it).
    if (path.startsWith('web/')) suites.add('web');
    else if (path.startsWith('cli/')) suites.add('cli');
    else if (appRoots.test(path) || appFiles.test(path)) suites.add('app');
    else if (unchecked.test(path)) continue;
    // A new top-level folder or config file must not slip past the gate.
    else return allChecks(`Unclassified input: ${path}`);
  }
  return {
    suites: CHECK_SUITES.filter((suite) => suites.has(suite)),
    reason: suites.size > 0 ? 'Branch diff and local changes' : 'Nothing the gate checks changed',
  };
}

const COVERAGE_GAPS = '.codex/skills/review-code-performance-tests/scripts/report-coverage-gaps.ts';

/** Cargo's gate for the website or the CLI, as their CI workflows run it. */
const cargoSteps = (label: string, cwd: string): CheckStep[] => [
  { name: `${label} format`, command: ['cargo', 'fmt', '--all', '--', '--check'], cwd },
  { name: `${label} clippy`, command: ['cargo', 'clippy', '--all-targets', '--locked', '--', '-D', 'warnings'], cwd },
  { name: `${label} tests`, command: ['cargo', 'test', '--locked'], cwd },
];

export function checkSteps(plan: CheckPlan): CheckStep[] {
  const steps: CheckStep[] = [];
  if (plan.suites.includes('app')) {
    steps.push(
      { name: 'App lint', command: ['bun', 'run', 'lint'] },
      { name: 'App typecheck', command: ['bun', 'run', 'typecheck'] },
      { name: 'App tests and coverage', command: ['bun', 'run', 'test:coverage'] },
      { name: 'Coverage gaps', command: ['bun', COVERAGE_GAPS] },
    );
  }
  if (plan.suites.includes('web')) steps.push(...cargoSteps('Website', 'web'));
  if (plan.suites.includes('cli')) steps.push(...cargoSteps('CLI', 'cli'));
  return steps;
}
