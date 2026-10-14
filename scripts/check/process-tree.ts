/**
 * A process and everything it started, so a wrapper can stop a command whose
 * work runs in grandchildren (`bun run` starting Expo starting Metro).
 */
import { spawnSync } from 'node:child_process';

/** Each parent's children, from `ps -A -o pid=,ppid=` output. */
export const parseProcessTable = (output: string): Map<number, number[]> => {
  const children = new Map<number, number[]>();
  for (const line of output.split('\n')) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (!Number.isSafeInteger(pid) || !Number.isSafeInteger(ppid) || pid <= 0) continue;
    children.set(ppid, [...(children.get(ppid) ?? []), pid]);
  }
  return children;
};

/** `root` and its descendants, parents first. Each process is visited once, so a malformed table cannot loop. */
export const treeOf = (root: number, children: Map<number, number[]>): number[] => {
  const tree = [root];
  const seen = new Set(tree);
  for (let index = 0; index < tree.length; index += 1) {
    for (const child of children.get(tree[index]) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      tree.push(child);
    }
  }
  return tree;
};

/** The running tree under `root`; just `root` when `ps` cannot be read. */
export const processTree = (root: number): number[] => {
  const result = spawnSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8' });
  if (result.status !== 0) return [root];
  return treeOf(root, parseProcessTable(result.stdout ?? ''));
};

/** Sends `signal` to every process in `pids`, skipping ones that already exited. */
export const signalProcesses = (pids: readonly number[], signal: NodeJS.Signals): void => {
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch {
      // Already gone.
    }
  }
};
