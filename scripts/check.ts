/**
 * The local PR gate: runs the suites the branch's changes need (see
 * `scripts/check/plan.ts`), one step after another. `mise run check` runs it
 * under the cross-worktree lock (`scripts/check-lock.ts`).
 *
 *   mise run check            # what this branch needs
 *   mise run check -- --all   # every suite
 *   mise run check -- --plan  # print the selection, run nothing
 */
import { spawn, spawnSync } from 'node:child_process';

import { checkSteps, planChecks } from './check/plan';

const BASE_REF = 'origin/master';

const git = (...args: string[]): string => {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Could not read change scope: git ${args[0]}`);
  return result.stdout;
};

/** Every path the branch changes, committed or not; null when git cannot say. */
function changedPaths(): string[] | null {
  try {
    // The whole branch, not just its last commit. --no-renames lists both sides
    // of a move, so a file moved across suites checks both.
    const base = git('merge-base', BASE_REF, 'HEAD').trim();
    return [
      ...new Set(
        [
          git('diff', '--name-only', '-z', '--no-renames', base, 'HEAD'),
          // Index and working tree separately: an unstaged restore can cancel a
          // staged edit in a net diff against HEAD, but that edit still ships.
          git('diff', '--cached', '--name-only', '-z', '--no-renames', 'HEAD'),
          git('diff', '--name-only', '-z', '--no-renames'),
          git('ls-files', '--others', '--exclude-standard', '-z'),
        ].flatMap((output) => output.split('\0').filter(Boolean)),
      ),
    ];
  } catch {
    return null;
  }
}

function runStep(command: string[], cwd: string | undefined): Promise<number> {
  const [program, ...args] = command;
  const child = spawn(program, args, { cwd, stdio: 'inherit' });
  const interrupt = () => child.kill('SIGINT');
  const terminate = () => child.kill('SIGTERM');
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  return new Promise<number>((resolve) => {
    child.on('error', (error) => {
      console.error(`[check] could not start ${program}: ${error.message}`);
      resolve(127);
    });
    child.on('exit', (code, signal) => {
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', terminate);
      resolve(signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : (code ?? 1));
    });
  });
}

async function main(argv: string[]): Promise<void> {
  if (argv.some((argument) => !['--all', '--plan'].includes(argument))) {
    console.error('Usage: mise run check -- [--all] [--plan]');
    process.exit(2);
  }
  const plan = planChecks(changedPaths(), argv.includes('--all'));
  const steps = checkSteps(plan);
  console.log(`[check] ${plan.reason}; suites: ${plan.suites.join(', ') || 'none'}`);
  if (argv.includes('--plan')) {
    for (const step of steps) {
      console.log(`[check] ${step.name}: ${step.command.join(' ')}${step.cwd ? ` (in ${step.cwd})` : ''}`);
    }
    return;
  }
  const failures: string[] = [];
  for (const step of steps) {
    console.log(`[check] ${step.name}`);
    const status = await runStep(step.command, step.cwd);
    if (status !== 0) failures.push(`${step.name} (${status})`);
    if (status === 130 || status === 143) break;
  }
  if (failures.length > 0) {
    console.error(`[check] Failed: ${failures.join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log(`[check] Passed ${steps.length} checks`);
  }
}

void main(process.argv.slice(2));
