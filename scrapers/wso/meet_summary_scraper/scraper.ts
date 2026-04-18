#!/usr/bin/env bun

import { ConvexHttpClient } from "convex/browser";

import { api } from "../../../convex/_generated/api.js";

type AthleteRow = {
  name: string;
  wso?: string | null;
};

type LiftRow = {
  meet: string;
  name: string;
  snatch1?: number | null;
  snatch2?: number | null;
  snatch3?: number | null;
  snatchBest?: number | null;
  cj1?: number | null;
  cj2?: number | null;
  cj3?: number | null;
  cjBest?: number | null;
  total?: number | null;
};

type ParsedArgs = {
  meet: string;
  wso: string;
};

const RESULT_MEET_ALIASES: Record<string, string[]> = {
  "2026 Masters National Championships & National University Championships": [
    "The 2026 National University Championships",
    "The 2026 USA Weightlifting Masters National Championships Powered by Rogue Fitness",
  ],
};

function printUsage() {
  console.log(`Usage:
  bun scrapers/wso/meet_summary_scraper/scraper.ts --meet "Meet Name" --wso "WSO Name"

Short flags:
  bun scrapers/wso/meet_summary_scraper/scraper.ts -m "Meet Name" -w "WSO Name"

Positional args:
  bun scrapers/wso/meet_summary_scraper/scraper.ts "Meet Name" "WSO Name"`);
}

function parseArgs(argv: string[]): ParsedArgs | "help" | null {
  if (argv.includes("--help") || argv.includes("-h")) {
    printUsage();
    return "help";
  }

  let meet = "";
  let wso = "";
  const positional: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--meet" || arg === "-m") {
      meet = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg === "--wso" || arg === "-w") {
      wso = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    positional.push(arg);
  }

  if (!meet && positional[0]) {
    meet = positional[0];
  }

  if (!wso && positional[1]) {
    wso = positional[1];
  }

  if (!meet || !wso) {
    printUsage();
    return null;
  }

  return {
    meet: meet.trim(),
    wso: wso.trim(),
  };
}

function normalize(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function getResultMeetNames(meet: string): string[] {
  return [meet, ...(RESULT_MEET_ALIASES[meet] ?? [])];
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function maxPositive(values: Array<number | null | undefined>): number | null {
  const successful = values.filter(
    (value): value is number => typeof value === "number" && value > 0,
  );

  if (successful.length === 0) {
    return null;
  }

  return Math.max(...successful);
}

function maxNullable(values: Array<number | null | undefined>): number | null {
  const numbers = values.filter(
    (value): value is number => typeof value === "number",
  );

  if (numbers.length === 0) {
    return null;
  }

  return Math.max(...numbers);
}

function deriveSnatchBest(row: LiftRow): number | null {
  return row.snatchBest ?? maxPositive([row.snatch1, row.snatch2, row.snatch3]);
}

function deriveCjBest(row: LiftRow): number | null {
  return row.cjBest ?? maxPositive([row.cj1, row.cj2, row.cj3]);
}

function deriveTotal(row: LiftRow): number | null {
  if (typeof row.total === "number") {
    return row.total;
  }

  const snatchBest = deriveSnatchBest(row);
  const cjBest = deriveCjBest(row);

  if (snatchBest == null || cjBest == null) {
    return null;
  }

  return snatchBest + cjBest;
}

function isRecordedAttempt(value: number | null | undefined): value is number {
  return typeof value === "number" && value !== 0;
}

function isPr(current: number | null, priorMax: number | null): boolean {
  if (current == null) {
    return false;
  }

  if (priorMax == null) {
    return true;
  }

  return current > priorMax;
}

function buildRowsByName(rows: LiftRow[]): Map<string, LiftRow[]> {
  const rowsByName = new Map<string, LiftRow[]>();

  for (const row of rows) {
    const existing = rowsByName.get(row.name) ?? [];
    existing.push(row);
    rowsByName.set(row.name, existing);
  }

  return rowsByName;
}

async function main() {
  const parsedArgs = parseArgs(process.argv.slice(2));

  if (parsedArgs === "help") {
    process.exit(0);
  }

  if (!parsedArgs) {
    process.exit(1);
  }

  const convexUrl =
    process.env.CONVEX_URL ?? process.env.EXPO_PUBLIC_CONVEX_URL;

  if (!convexUrl) {
    console.error(
      "Missing CONVEX_URL or EXPO_PUBLIC_CONVEX_URL in the environment.",
    );
    process.exit(1);
  }

  const client = new ConvexHttpClient(convexUrl, { logger: false });
  const meet = parsedArgs.meet;
  const wso = parsedArgs.wso;
  const normalizedMeet = normalize(meet);
  const normalizedWso = normalize(wso);
  const resultMeetNames = getResultMeetNames(meet);
  const normalizedResultMeetNames = new Set(resultMeetNames.map(normalize));

  const meetRecord = await client.query(api.meets.getByName, { name: meet });

  if (!meetRecord) {
    const allMeets = await client.query(api.meets.listAll, {});
    const suggestions = allMeets
      .map((row) => row.name)
      .filter((name) => normalize(name).includes(normalizedMeet))
      .slice(0, 10);

    console.error(`Meet not found: ${meet}`);
    if (suggestions.length > 0) {
      console.error("\nClosest matches:");
      for (const suggestion of suggestions) {
        console.error(`- ${suggestion}`);
      }
    }
    process.exit(1);
  }

  const athletes = (await client.query(api.athletes.getByMeet, {
    meet,
  })) as AthleteRow[];

  if (athletes.length === 0) {
    console.error(`No athletes found for meet: ${meet}`);
    process.exit(1);
  }

  const availableWsos = [...new Set(
    athletes
      .map((athlete) => athlete.wso?.trim())
      .filter((value): value is string => Boolean(value)),
  )].sort((left, right) => left.localeCompare(right));

  const filteredAthletes = athletes.filter(
    (athlete) => normalize(athlete.wso) === normalizedWso,
  );

  if (filteredAthletes.length === 0) {
    console.error(`No athletes found for WSO "${wso}" in meet "${meet}".`);
    if (availableWsos.length > 0) {
      console.error("\nAvailable WSOs in this meet:");
      for (const availableWso of availableWsos) {
        console.error(`- ${availableWso}`);
      }
    }
    process.exit(1);
  }

  const names = [...new Set(
    filteredAthletes
      .map((athlete) => athlete.name?.trim())
      .filter((value): value is string => Boolean(value)),
  )];

  const historyRows = (await client.query(api.liftingResults.getByNames, {
    names,
  })) as LiftRow[];

  const rowsByName = buildRowsByName(historyRows);
  const targetMeetRows: LiftRow[] = [];
  const missingResultsNames: string[] = [];

  let snatchPrCount = 0;
  let cjPrCount = 0;
  let totalPrCount = 0;

  for (const name of names) {
    const athleteRows = rowsByName.get(name) ?? [];
    const currentRows = athleteRows.filter(
      (row) => normalizedResultMeetNames.has(normalize(row.meet)),
    );

    if (currentRows.length === 0) {
      missingResultsNames.push(name);
      continue;
    }

    targetMeetRows.push(...currentRows);

    const priorRows = athleteRows.filter(
      (row) => !normalizedResultMeetNames.has(normalize(row.meet)),
    );

    const currentSnatch = maxNullable(currentRows.map(deriveSnatchBest));
    const currentCj = maxNullable(currentRows.map(deriveCjBest));
    const currentTotal = maxNullable(currentRows.map(deriveTotal));

    const priorSnatch = maxNullable(priorRows.map(deriveSnatchBest));
    const priorCj = maxNullable(priorRows.map(deriveCjBest));
    const priorTotal = maxNullable(priorRows.map(deriveTotal));

    if (isPr(currentSnatch, priorSnatch)) {
      snatchPrCount += 1;
    }

    if (isPr(currentCj, priorCj)) {
      cjPrCount += 1;
    }

    if (isPr(currentTotal, priorTotal)) {
      totalPrCount += 1;
    }
  }

  let snatchAttempts = 0;
  let snatchMakes = 0;
  let cjAttempts = 0;
  let cjMakes = 0;
  let totalWeightLifted = 0;

  for (const row of targetMeetRows) {
    for (const attempt of [row.snatch1, row.snatch2, row.snatch3]) {
      if (isRecordedAttempt(attempt)) {
        snatchAttempts += 1;
        if (attempt > 0) {
          snatchMakes += 1;
          totalWeightLifted += attempt;
        }
      }
    }

    for (const attempt of [row.cj1, row.cj2, row.cj3]) {
      if (isRecordedAttempt(attempt)) {
        cjAttempts += 1;
        if (attempt > 0) {
          cjMakes += 1;
          totalWeightLifted += attempt;
        }
      }
    }
  }

  const snatchMakeRate =
    snatchAttempts > 0 ? (snatchMakes / snatchAttempts) * 100 : 0;
  const cjMakeRate = cjAttempts > 0 ? (cjMakes / cjAttempts) * 100 : 0;
  const totalMakeRate = (snatchMakeRate + cjMakeRate) / 2;
  const athletesWithResults = names.length - missingResultsNames.length;

  console.log(`Meet: ${meet}`);
  console.log(`WSO: ${wso}`);
  if (
    resultMeetNames.length > 1 ||
    normalize(resultMeetNames[0]) !== normalizedMeet
  ) {
    console.log(`Results meet names: ${resultMeetNames.join(" | ")}`);
  }
  console.log(`Athletes in meet: ${formatNumber(athletes.length)}`);
  console.log(`Athletes in WSO: ${formatNumber(filteredAthletes.length)}`);

  console.log("\nMake Rates");
  console.log(
    `Snatch: ${formatPercent(snatchMakeRate)} (${formatNumber(snatchMakes)}/${formatNumber(snatchAttempts)})`,
  );
  console.log(
    `Clean & Jerk: ${formatPercent(cjMakeRate)} (${formatNumber(cjMakes)}/${formatNumber(cjAttempts)})`,
  );
  console.log(`Total: ${formatPercent(totalMakeRate)}`);

  console.log("\nVolume");
  console.log(`Total weight lifted: ${formatNumber(totalWeightLifted)} kg`);

  console.log("\nPR Counts");
  console.log(`Snatch PRs: ${formatNumber(snatchPrCount)}`);
  console.log(`Clean & Jerk PRs: ${formatNumber(cjPrCount)}`);
  console.log(`Total PRs: ${formatNumber(totalPrCount)}`);

}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "Unknown error while running scraper.";
  console.error(message);
  process.exit(1);
});
