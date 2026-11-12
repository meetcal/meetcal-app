import { itemAt } from '../../lib/json';

/**
 * A unified diff of two texts, line by line, with `context` unchanged lines
 * around each change (what urlwatch reported). The pages
 * watched are a few hundred lines, so a plain longest-common-subsequence
 * table is fast enough.
 */
export function unifiedDiff(before: string, after: string, context = 3): string {
  const a = before.split('\n');
  const b = after.split('\n');
  const lcs = Array.from({ length: a.length + 1 }, () => new Int32Array(b.length + 1));
  const common = (i: number, j: number) => lcs[i]?.[j] ?? 0;
  for (let i = a.length - 1; i >= 0; i--) {
    const row = itemAt(lcs, i);
    for (let j = b.length - 1; j >= 0; j--) row[j] = a[i] === b[j] ? common(i + 1, j + 1) + 1 : Math.max(common(i + 1, j), common(i, j + 1));
  }
  type Op = { kind: ' ' | '-' | '+'; text: string; aLine: number; bLine: number };
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    const [removed, added] = [a[i], b[j]];
    if (removed !== undefined && added !== undefined && removed === added) {
      i += 1;
      j += 1;
      ops.push({ kind: ' ', text: removed, aLine: i, bLine: j });
    } else if (removed !== undefined && (added === undefined || common(i + 1, j) >= common(i, j + 1))) {
      i += 1;
      ops.push({ kind: '-', text: removed, aLine: i, bLine: j });
    } else if (added !== undefined) {
      j += 1;
      ops.push({ kind: '+', text: added, aLine: i, bLine: j });
    }
  }
  const changed = ops.map((op, index) => (op.kind === ' ' ? -1 : index)).filter((index) => index >= 0);
  if (changed.length === 0) return '';
  // Group changes whose context windows touch into hunks.
  const hunks: [number, number][] = [];
  for (const index of changed) {
    const start = Math.max(0, index - context);
    const end = Math.min(ops.length - 1, index + context);
    const last = hunks[hunks.length - 1];
    if (last && start <= last[1] + 1) last[1] = end;
    else hunks.push([start, end]);
  }
  const out: string[] = [];
  for (const [start, end] of hunks) {
    const slice = ops.slice(start, end + 1);
    const aCount = slice.filter((op) => op.kind !== '+').length;
    const bCount = slice.filter((op) => op.kind !== '-').length;
    const first = itemAt(ops, start);
    const aStart = first.kind === '+' ? first.aLine + (aCount ? 1 : 0) : first.aLine;
    const bStart = first.kind === '-' ? first.bLine + (bCount ? 1 : 0) : first.bLine;
    out.push(`@@ -${aStart},${aCount} +${bStart},${bCount} @@`);
    for (const op of slice) out.push(`${op.kind}${op.text}`);
  }
  return out.join('\n');
}
