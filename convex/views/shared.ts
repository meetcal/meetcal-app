
/** A refresh that finds another running tries again after this. */
export const REFRESH_BUSY_RETRY_MS = 30 * 1000;

/**
 * While a full rebuild is marked running, a refresh stays queued this far
 * ahead: it waits for the rebuild, and restarts it if its stages stopped.
 */
export const REBUILD_WAIT_MS = 60 * 1000;

/**
 * A rebuild stage starts at least every 10 minutes (Convex stops an action
 * there); a rebuild silent for longer than this had a stage fail, and is
 * started again rather than waited on forever.
 */
export const REBUILD_STALE_MS = 15 * 60 * 1000;

export type Hint = { id: string; kind: string; key: string; seq: number; since?: string };

export const REBUILD_STAGES = ['scan', 'histories', 'prune', 'nat', 'meets', 'reference', 'sweep'] as const;

export type RebuildStage = (typeof REBUILD_STAGES)[number];

/** Where a rebuild stage started: what a rebuild that stopped resumes from. */
export type RebuildPosition = {
  stage: RebuildStage;
  offset: number;
  after?: string;
  cursor?: string;
  startedAt: number;
  again: boolean;
};

export type RefreshBegin = {
  hints: Hint[];
  overflow: boolean;
  /** More hints are pending than this refresh read (MAX_REFRESH_HINTS). */
  more?: boolean;
  /** The creation time of the last hint read, where the next page starts. */
  lastRead?: number | null;
  rebuilding: boolean;
  rebuildHeartbeat: number | null;
  rebuildPosition: RebuildPosition | null;
  /** This refresh's lease, or null when another refresh holds it (or none was asked for). */
  lease: number | null;
  busy: boolean;
};

/** Hints deleted (or requeued) per mutation. */
export const HINT_DELETE_BATCH = 1000;

/** Each stage action, and each refresh, stops after this long and schedules its continuation. */
export const STAGE_BUDGET_MS = 3 * 60 * 1000;
