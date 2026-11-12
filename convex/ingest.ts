/**
 * The write path for competition data. Scrapers and syncs call these internal
 * mutations (with a deploy key); nothing else may write the source tables,
 * because every write here does three things the materialized views rely on
 * (`convex/lib/views.ts`):
 *
 * 1. leaves hints naming what changed (old and new values of each row): the
 *    views those rows feed stop being served until the refresh has rebuilt
 *    them, and only those are rebuilt (result writes also rewrite the touched
 *    athletes' history documents, in the same transaction);
 * 2. bumps the table's version (the stamp builders record);
 * 3. schedules that refresh.
 */

export * from './ingest/shared';
export * from './ingest/hints';
export * from './ingest/results';
export * from './ingest/rosters';
export * from './ingest/meets';
export * from './ingest/reference';
export * from './ingest/records';
