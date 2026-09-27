/**
 * Latency of the Convex API against the Rust API, one case per app call.
 *
 *   nice -n 19 bun scripts/bench/convex-vs-rust.ts [--rust http://127.0.0.1:3000] [--only name,...]
 *
 * Requests are strictly sequential (no concurrency): the Rust side is the
 * production API, so this must stay at the load of one person using the app.
 *
 * Per case it reports:
 * - rust: steady-state latency of the Rust route.
 * - convex hit: identical arguments repeated, i.e. served from Convex's query
 *   cache, which is what nearly every request is between data changes.
 * - convex miss: arguments varied so the query really runs (a random
 *   `ifNoneMatch`, or reordered names): the cost right after a data change.
 * - rtt: a constant Convex query, the network floor to the deployment, so
 *   `miss - rtt` is roughly server time (plus the transfer of a large body).
 *
 * Both sides include parsing the answer's JSON, as the app does.
 */
import { ConvexClient, ConvexHttpClient } from 'convex/browser';
import { anyApi } from 'convex/server';
import { readFileSync } from 'node:fs';

type Case = {
  name: string;
  rust: { method: 'GET' | 'POST'; path: string; query?: Record<string, string>; body?: unknown };
  convex: { fn: string; args: Record<string, unknown> };
  /** Varies the Convex arguments so the query cannot come from the cache. */
  bust?: (args: Record<string, unknown>, i: number) => Record<string, unknown>;
};

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
};
const RUST = flag('--rust') ?? 'http://127.0.0.1:3000';
const ONLY = flag('--only')?.split(',');
const RUNS = Number(flag('--runs') ?? 12);
const CONVEX_URL =
  process.env.EXPO_PUBLIC_CONVEX_URL ??
  /EXPO_PUBLIC_CONVEX_URL=(\S+)/.exec(readFileSync('.env.local', 'utf8'))?.[1];
if (!CONVEX_URL) throw new Error('EXPO_PUBLIC_CONVEX_URL is not set');

const BIG_MEET = '2025 Virus Weightlifting Finals, Powered by Rogue Fitness';
const today = new Date();
const isoDaysAgo = (days: number) => new Date(today.getTime() - days * 86_400_000).toISOString().slice(0, 10);
const TWO_YEARS_AGO = isoDaysAgo(730);
const ONE_YEAR_AGO = isoDaysAgo(365);

const bustEtag = (args: Record<string, unknown>, i: number) => ({ ...args, ifNoneMatch: `"bust-${Date.now()}-${i}"` });
/**
 * Swaps the last name for one nobody has, unique per run, so the arguments
 * are new to Convex's query cache every time (rotating the list repeated
 * across runs and came back cached). One of the names costs a lookup that
 * finds nothing; the rest is the same work.
 */
const rotateNames = (args: Record<string, unknown>, i: number) => {
  const names = [...(args.names as string[])];
  names[names.length - 1] = `zz bench ${Date.now().toString(36)} ${i}`;
  return { ...args, names };
};

/** Answers carrying `json` text are parsed, as the app client does. */
function decode(result: unknown): unknown {
  if (result && typeof result === 'object' && typeof (result as { json?: unknown }).json === 'string') {
    return JSON.parse((result as { json: string }).json);
  }
  return result;
}

async function rosterNames(client: ConvexClient, count: number): Promise<string[]> {
  const rows = decode(await client.query(anyApi.meets.athletes, { meet: BIG_MEET })) as { name: string }[];
  return rows.slice(0, count).map((r) => r.name);
}

function buildCases(names40: string[], names100: string[]): Case[] {
  const meetQ = { meet: BIG_MEET };
  return [
    { name: 'meets list', rust: { method: 'GET', path: '/meets' }, convex: { fn: 'meets:list', args: { now: Math.floor(Date.now() / 3.6e6) * 3.6e6 } }, bust: bustEtag },
    { name: 'meet details', rust: { method: 'GET', path: '/meets/details', query: meetQ }, convex: { fn: 'meets:details', args: meetQ }, bust: bustEtag },
    { name: 'meet schedule', rust: { method: 'GET', path: '/meets/schedule', query: meetQ }, convex: { fn: 'meets:schedule', args: meetQ }, bust: bustEtag },
    { name: 'start list (athletes-sessions)', rust: { method: 'GET', path: '/meets/athletes-sessions', query: meetQ }, convex: { fn: 'meets:athletesSessions', args: meetQ } },
    { name: 'one session', rust: { method: 'GET', path: '/meets/athletes-sessions', query: { ...meetQ, session_number: '5' } }, convex: { fn: 'meets:athletesSessions', args: { ...meetQ, sessionNumber: 5 } } },
    {
      name: 'meet package (+year bests)',
      rust: { method: 'GET', path: '/meets/package', query: { ...meetQ, history_cutoff_date: TWO_YEARS_AGO, include: 'year_bests' } },
      convex: { fn: 'meets:packageForMeet', args: { ...meetQ, historyCutoffDate: TWO_YEARS_AGO, include: ['year_bests'] } },
      bust: bustEtag,
    },
    { name: 'history 40 names', rust: { method: 'POST', path: '/lifting-results/by-names', body: { names: names40 } }, convex: { fn: 'results:byNames', args: { names: names40 } }, bust: rotateNames },
    { name: 'latest meet 100 names', rust: { method: 'POST', path: '/lifting-results/by-names', body: { names: names100, latest_only: true } }, convex: { fn: 'results:byNames', args: { names: names100, latestOnly: true } }, bust: rotateNames },
    { name: 'bests 100 names', rust: { method: 'POST', path: '/lifting-results/bests', body: { names: names100, cutoff_date: ONE_YEAR_AGO } }, convex: { fn: 'results:bests', args: { names: names100, cutoffDate: ONE_YEAR_AGO } }, bust: rotateNames },
    { name: 'recent 40 names', rust: { method: 'POST', path: '/lifting-results/recent', body: { names: names40, cutoff_date: TWO_YEARS_AGO } }, convex: { fn: 'results:recent', args: { names: names40, cutoffDate: TWO_YEARS_AGO } }, bust: rotateNames },
    { name: 'year bests 1 name', rust: { method: 'GET', path: '/lifting-results/year', query: { name: names40[0], cutoff_date: ONE_YEAR_AGO } }, convex: { fn: 'results:yearBests', args: { name: names40[0], cutoffDate: ONE_YEAR_AGO } } },
    { name: 'search suggestions', rust: { method: 'GET', path: '/search', query: { query: 'john' } }, convex: { fn: 'results:search', args: { query: 'john' } } },
    { name: 'search exact name', rust: { method: 'GET', path: '/search', query: { query: names40[1], start_date: '2025-01-01', end_date: '2026-01-01' } }, convex: { fn: 'results:search', args: { query: names40[1], startDate: '2025-01-01', endDate: '2026-01-01' } } },
    { name: 'national rankings (M85)', rust: { method: 'GET', path: '/data/nat-rankings', query: { federation: 'USAW', age_category: "Open Men's 85 kg" } }, convex: { fn: 'reference:nationalRankings', args: { federation: 'USAW', ageCategory: "Open Men's 85 kg" } }, bust: bustEtag },
    { name: 'records', rust: { method: 'GET', path: '/data/records' }, convex: { fn: 'reference:records', args: {} }, bust: bustEtag },
    { name: 'standards', rust: { method: 'GET', path: '/data/standards' }, convex: { fn: 'reference:standards', args: {} }, bust: bustEtag },
    { name: 'qualifying totals', rust: { method: 'GET', path: '/data/qualifying-totals' }, convex: { fn: 'reference:qualifyingTotals', args: {} }, bust: bustEtag },
    { name: 'intl rankings', rust: { method: 'GET', path: '/data/intl-rankings' }, convex: { fn: 'reference:intlRankings', args: {} }, bust: bustEtag },
    { name: 'wso list', rust: { method: 'GET', path: '/data/wso/' }, convex: { fn: 'reference:wsoList', args: {} }, bust: bustEtag },
    { name: 'wso records', rust: { method: 'GET', path: '/data/wso/records', query: { wso: 'Florida' } }, convex: { fn: 'reference:wsoRecords', args: { wso: 'Florida' } }, bust: bustEtag },
    { name: 'adaptive records', rust: { method: 'GET', path: '/data/adaptive', query: { gender: 'men', exclude_federation: 'BWL' } }, convex: { fn: 'reference:adaptiveRecords', args: { gender: 'men', excludeFederation: 'BWL' } }, bust: bustEtag },
    { name: 'club names', rust: { method: 'GET', path: '/clubs' }, convex: { fn: 'reference:clubs', args: {} }, bust: bustEtag },
    { name: 'club meet stats', rust: { method: 'GET', path: '/clubs/meet-stats', query: { club: 'Unaffiliated', meet: '2025 Virus Weightlifting Finals, Powered by Rogue Fitness' } }, convex: { fn: 'reference:clubMeetStats', args: { club: 'Unaffiliated', meet: '2025 Virus Weightlifting Finals, Powered by Rogue Fitness' } } },
  ];
}

function fnRef(name: string) {
  const [module, fn] = name.split(':');
  return (anyApi as any)[module][fn];
}

async function timeRust(c: Case): Promise<{ ms: number; bytes: number; status: number }> {
  const url = new URL(c.rust.path, RUST);
  for (const [k, v] of Object.entries(c.rust.query ?? {})) url.searchParams.set(k, v);
  const started = performance.now();
  const response = await fetch(url, {
    method: c.rust.method,
    headers: { 'X-MeetCal-App': '6.2.0', Accept: 'application/json', ...(c.rust.body ? { 'Content-Type': 'application/json' } : {}) },
    body: c.rust.body ? JSON.stringify(c.rust.body) : undefined,
  });
  const text = await response.text();
  if (response.status === 200) JSON.parse(text);
  return { ms: performance.now() - started, bytes: text.length, status: response.status };
}

/**
 * Timed over HTTP (kept-alive connection), not the WebSocket client: the
 * WebSocket client answers a repeat of a query it still holds from its own
 * local copy, which would time the client rather than the server.
 */
async function timeConvex(client: ConvexHttpClient, fn: string, args: Record<string, unknown>) {
  const started = performance.now();
  const result = await client.query(fnRef(fn), args);
  decode(result);
  const ms = performance.now() - started;
  return { ms, bytes: JSON.stringify(result).length };
}

const pct = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
};
const fmt = (n: number) => n.toFixed(1).padStart(7);
const kb = (n: number) => `${(n / 1024).toFixed(0)}KB`.padStart(7);

async function main() {
  const ws = new ConvexClient(CONVEX_URL!, { unsavedChangesWarning: false });
  const client = new ConvexHttpClient(CONVEX_URL!);
  const rtts: number[] = [];
  for (let i = 0; i < RUNS + 3; i++) rtts.push((await timeConvex(client, 'system:ping', {})).ms);
  const rtt = pct(rtts.slice(3), 50);
  console.log(`convex ${CONVEX_URL}  rtt p50 ${rtt.toFixed(1)}ms   rust ${RUST}\n`);

  const names100 = await rosterNames(ws, 100);
  const cases = buildCases(names100.slice(0, 40), names100).filter((c) => !ONLY || ONLY.includes(c.name));

  console.log(`${'case'.padEnd(32)} ${'rust p50'.padStart(8)} ${'hit p50'.padStart(8)} ${'miss p50'.padStart(8)} ${'miss-rtt'.padStart(8)}   rust KB  cvx KB   (* one sample)`);
  for (const c of cases) {
    const rust: number[] = [];
    let rustBytes = 0;
    let rustStatus = 0;
    for (let i = 0; i < RUNS; i++) {
      const r = await timeRust(c);
      rust.push(r.ms);
      rustBytes = r.bytes;
      rustStatus = r.status;
    }
    const hits: number[] = [];
    let convexBytes = 0;
    let first = NaN;
    for (let i = 0; i < RUNS + 1; i++) {
      const r = await timeConvex(client, c.convex.fn, c.convex.args);
      if (i === 0) first = r.ms;
      else hits.push(r.ms);
      convexBytes = r.bytes;
    }
    const misses: number[] = [];
    if (c.bust) {
      for (let i = 0; i < Math.max(4, Math.floor(RUNS / 2)); i++) {
        misses.push((await timeConvex(client, c.convex.fn, c.bust(c.convex.args, i))).ms);
      }
    }
    // Without a way to bust the cache, the first call (a miss unless this
    // case ran moments ago) is the only miss sample.
    const miss = misses.length ? pct(misses, 50) : first;
    console.log(
      `${c.name.padEnd(32)} ${fmt(pct(rust, 50))} ${fmt(pct(hits, 50))} ${fmt(miss)}${misses.length ? ' ' : '*'}${fmt(miss - rtt)}  ${kb(rustBytes)} ${kb(convexBytes)}${rustStatus !== 200 ? `  (rust ${rustStatus})` : ''}`,
    );
  }
  await ws.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
