/**
 * The platforms the app has a fixed sort position for. Everything else is
 * still a valid platform (the backend stores the name as free text and
 * scrapers title-case whatever the meet publishes), so this union is only for
 * the places that genuinely need a literal list, such as the sort order.
 */
export const KNOWN_PLATFORMS = ['Red', 'White', 'Blue', 'Stars', 'Stripes', 'Rogue'] as const;
export type KnownPlatform = (typeof KNOWN_PLATFORMS)[number];

/**
 * A session platform name in canonical form: trimmed, inner whitespace
 * collapsed, each word title-cased (`"RED "` → `"Red"`, `"gold"` → `"Gold"`).
 * Produced by `canonicalizePlatform` in `lib/athletes.ts`; never coerced to a
 * known name, so a meet with a Gold platform keeps it.
 */
export type Platform = string;

/**
 * Canonical name for a schedule/athlete row whose platform is blank. The
 * schedule renders it like any other platform (a badge with this label) and
 * session ids stay unique per session number, which an empty string would not
 * give.
 */
export const UNKNOWN_PLATFORM: Platform = 'Unknown';

export interface LiftResult {
  memberId: string;
  name: string;
  age: number;
  club: string;
  wso?: string;
  gender: string;
  weightClass: string;
  entryTotal: number;
  adaptive: boolean;
  session?: {
    number: number;
    platform: Platform;
    date?: string;
    startTime?: string;
    weighInTime?: string;
    displayDate?: string;
  };
}

export interface SupabaseLiftResult {
  id: number;
  event_id: string;
  meet: string;
  date: string;
  name: string;
  age: string | number;
  body_weight: number;
  snatch1: number | null;
  snatch2: number | null;
  snatch3: number | null;
  snatch_best: number | null;
  cj1: number | null;
  cj2: number | null;
  cj3: number | null;
  cj_best: number | null;
  total: number | null;
}

export interface SupabaseBests {
  snatch_best: number | null;
  cj_best: number | null;
  total: number | null;
}
