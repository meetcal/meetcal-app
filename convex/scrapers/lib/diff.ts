/**
 * A unified diff of two texts, line by line, with `context` unchanged lines
 * around each change (what urlwatch put in its Slack reports). The pages
 * watched are a few hundred lines, so a plain longest-common-subsequence
 * table is fast enough.
 */
export function unifiedDiff(before: string, after: string, context = 3): string {
  const a = before.split('\n');
  const b = after.split('\n');
  // lcs[i][j]: length of the longest common subsequence of a[i..] and b[j..].
  const lcs = Array.from({ length: a.length + 1 }, () => new Int32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  type Op = { kind: ' ' | '-' | '+'; text: string; aLine: number; bLine: number };
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) ops.push({ kind: ' ', text: a[i++], aLine: i, bLine: ++j });
    // Removals before additions, as unified diffs show a replaced line.
    else if (i < a.length && (j === b.length || lcs[i + 1][j] >= lcs[i][j + 1])) ops.push({ kind: '-', text: a[i++], aLine: i, bLine: j });
    else ops.push({ kind: '+', text: b[j++], aLine: i, bLine: j });
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
    const first = ops[start];
    const aStart = first.kind === '+' ? first.aLine + (aCount ? 1 : 0) : first.aLine;
    const bStart = first.kind === '-' ? first.bLine + (bCount ? 1 : 0) : first.bLine;
    out.push(`@@ -${aStart},${aCount} +${bStart},${bCount} @@`);
    for (const op of slice) out.push(`${op.kind}${op.text}`);
  }
  return out.join('\n');
}
