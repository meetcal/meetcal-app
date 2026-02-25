import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

const PAGE_SIZE = 1000;
const SOURCE_TABLES = ["saved_sessions", "user_saved_sessions"] as const;

type SupabaseRow = Record<string, unknown>;

type SavedSessionUpsertArgs = {
  sessionId: string;
  userId: string;
  meet: string;
  sessionNumber: number;
  platform: string;
  weightClass?: string;
  startTime?: string;
  notes?: string;
  athleteNames?: string[];
  date?: string;
};

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toStringValue(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function normalizeSegment(value: string | number): string {
  return String(value).trim().replace(/\s+/g, "-");
}

function buildSessionId(meet: string, sessionNumber: number, platform: string): string {
  return `${normalizeSegment(meet)}-${normalizeSegment(sessionNumber)}-${normalizeSegment(platform)}`;
}

function toStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const cleaned = value
      .map((item) => toStringValue(item)?.trim())
      .filter((item): item is string => Boolean(item));
    return cleaned.length > 0 ? Array.from(new Set(cleaned)) : undefined;
  }
  if (typeof value === "string" && value.trim().startsWith("[")) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return toStringArray(parsed);
      }
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function mapSupabaseRowToSavedSession(row: SupabaseRow): SavedSessionUpsertArgs | null {
  const userIdRaw = row.user_id ?? row.userId ?? row.clerk_user_id;
  const meetRaw = row.meet ?? row.meet_name ?? row.meetName;
  const sessionNumberRaw = row.session_number ?? row.session_num ?? row.sessionNumber ?? row.session_id;
  const platformRaw = row.platform ?? row.session_platform ?? row.sessionPlatform;

  const userId = toStringValue(userIdRaw)?.trim();
  const meet = toStringValue(meetRaw)?.trim();
  const sessionNumber = toNumber(sessionNumberRaw);
  const platform = toStringValue(platformRaw)?.trim();

  if (!userId || !meet || sessionNumber == null || !platform) {
    return null;
  }

  const weightClass = toStringValue(row.weight_class ?? row.weightClass)?.trim() ?? undefined;
  const startTime = toStringValue(row.start_time ?? row.startTime)?.trim() ?? undefined;
  const notes = toStringValue(row.notes)?.trim() ?? undefined;
  const date = toStringValue(row.date)?.trim() ?? undefined;
  const athleteNames = toStringArray(row.athlete_names ?? row.athleteNames);

  return {
    sessionId: buildSessionId(meet, sessionNumber, platform),
    userId,
    meet,
    sessionNumber,
    platform,
    weightClass,
    startTime,
    notes,
    athleteNames,
    date,
  };
}

function getUpdatedAtMs(row: SupabaseRow): number {
  const value = row.updated_at ?? row.updatedAt ?? row.created_at ?? row.createdAt;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return 0;
}

async function fetchSupabaseTableRows(table: string): Promise<{ rows: SupabaseRow[]; missing: boolean }> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("SUPABASE_URL and SUPABASE_KEY are required");
  }

  const headers = {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    "Content-Type": "application/json",
  };

  const rows: SupabaseRow[] = [];
  let offset = 0;
  while (true) {
    const url = `${supabaseUrl}/rest/v1/${table}?select=*&limit=${PAGE_SIZE}&offset=${offset}`;
    const resp = await fetch(url, { headers });
    if (!resp.ok) {
      if (resp.status === 404 && offset === 0) {
        return { rows: [], missing: true };
      }
      throw new Error(`Failed to fetch ${table} at offset ${offset}: ${resp.status} ${resp.statusText}`);
    }
    const page = (await resp.json()) as SupabaseRow[];
    if (page.length === 0) break;
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return { rows, missing: false };
}

export const run = internalAction({
  args: {},
  handler: async (ctx) => {
    const upsertSystemRef = (
      internal as unknown as { savedSessions: { upsertSystem: any } }
    ).savedSessions.upsertSystem;
    const deduped = new Map<string, { row: SavedSessionUpsertArgs; updatedAtMs: number }>();
    const sourceStats: Record<string, { fetched: number; missing: boolean; mapped: number; skipped: number }> = {};

    for (const table of SOURCE_TABLES) {
      const { rows, missing } = await fetchSupabaseTableRows(table);
      let mapped = 0;
      let skipped = 0;

      for (const row of rows) {
        const mappedRow = mapSupabaseRowToSavedSession(row);
        if (!mappedRow) {
          skipped++;
          continue;
        }
        mapped++;
        const key = `${mappedRow.userId}::${mappedRow.sessionId}`;
        const updatedAtMs = getUpdatedAtMs(row);
        const existing = deduped.get(key);
        if (!existing || updatedAtMs >= existing.updatedAtMs) {
          deduped.set(key, { row: mappedRow, updatedAtMs });
        }
      }

      sourceStats[table] = { fetched: rows.length, missing, mapped, skipped };
    }

    let upserted = 0;
    for (const { row } of deduped.values()) {
      await ctx.runMutation(upsertSystemRef, row as any);
      upserted++;
    }

    return {
      sourceStats,
      mergedRows: deduped.size,
      upserted,
    };
  },
});
