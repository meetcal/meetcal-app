/**
 * The reference syncs (records, standards) delete the classes their source
 * no longer lists (`ingest.pruneRecords`, `ingest.pruneStandards`), and the
 * prune refuses to delete much without `allowShrink`. It is checked before
 * anything is written, so a refused prune leaves the stored set as it was
 * rather than the new classes stored beside the ones it would delete.
 */
type Prune = (options: { allowShrink: boolean; dryRun: boolean }) => Promise<{ deleted: string[] }>;

/** What a sync's `dryRun` reports: the classes the prune would delete, and why it would refuse, if it would. */
export async function previewPrune(prune: Prune, allowShrink: boolean): Promise<{ deleted: string[]; pruneRefused?: string }> {
  const { deleted } = await prune({ allowShrink: true, dryRun: true });
  try {
    await prune({ allowShrink, dryRun: true });
    return { deleted };
  } catch (error) {
    return { deleted, pruneRefused: (error as Error).message };
  }
}

/** Checks the prune's guard (throws when it refuses, nothing written), writes, then prunes. */
export async function writeThenPrune<T>(prune: Prune, allowShrink: boolean, write: () => Promise<T>): Promise<{ written: T; deleted: string[] }> {
  await prune({ allowShrink, dryRun: true });
  const written = await write();
  const { deleted } = await prune({ allowShrink, dryRun: false });
  return { written, deleted };
}
