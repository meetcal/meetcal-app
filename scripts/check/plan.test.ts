import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { checkSteps, planChecks, type CheckPlan } from './plan';

const suites = (paths: string[]) => planChecks(paths).suites;
const names = (plan: CheckPlan) => checkSteps(plan).map((step) => step.name);

describe('planChecks', () => {
  it('runs everything when asked, or when the change scope is unknown', () => {
    expect(planChecks(['src/app/index.tsx'], true).suites).toEqual(['app', 'web', 'cli']);
    expect(planChecks(null).suites).toEqual(['app', 'web', 'cli']);
    expect(planChecks([]).suites).toEqual(['app', 'web', 'cli']);
  });

  it('runs nothing for documentation, CI workflows, skills or device flows', () => {
    const plan = planChecks([
      'README.md',
      'docs/testing.md',
      'web/AGENTS.md',
      '.github/workflows/ci.yml',
      '.claude/skills/grilling/SKILL.md',
      '.codex/skills/review-code-performance-tests/agents/openai.yaml',
      '.maestro/00-main-tabs.yaml',
      '.gitignore',
    ]);
    expect(plan.suites).toEqual([]);
    expect(checkSteps(plan)).toEqual([]);
  });

  it('runs the app suite for app, backend and shared config changes', () => {
    for (const path of [
      'src/lib/api/meetcal-api.ts',
      'convex/meets.ts',
      'convex-tests/views.property.test.ts',
      'widget/build.gradle',
      'plugins/ios-app-intents/MeetCalAPI.swift',
      'jest/fast-check-config.js',
      'package.json',
      'bun.lock',
      'app.config.js',
      'fingerprint.config.js',
      'jest.setup.js',
      'eslint.config.js',
      'scripts/usamw-results.ts',
      '.codex/skills/review-code-performance-tests/scripts/report-coverage-gaps.ts',
    ]) {
      expect(suites([path])).toEqual(['app']);
    }
  });

  it('runs only the website or CLI suite for their folders', () => {
    expect(suites(['web/src/utils/api.rs'])).toEqual(['web']);
    expect(suites(['cli/src/commands/meets.rs'])).toEqual(['cli']);
    expect(suites(['web/src/main.rs', 'cli/Cargo.toml', 'src/utils/time.ts'])).toEqual(['app', 'web', 'cli']);
  });

  it('runs everything when the gate or its toolchain changes', () => {
    for (const path of ['scripts/check.ts', 'scripts/check-lock.ts', 'scripts/check/plan.ts', 'mise.toml']) {
      expect(planChecks([path]).suites).toEqual(['app', 'web', 'cli']);
    }
  });

  it('runs everything for an input it cannot classify', () => {
    const plan = planChecks(['src/app/index.tsx', 'new-tool.config.ts']);
    expect(plan.suites).toEqual(['app', 'web', 'cli']);
    expect(plan.reason).toContain('new-tool.config.ts');
  });

  it("classifies every file in the repository without falling back to 'everything'", () => {
    const root = join(__dirname, '..', '..');
    const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
    const gate = /^(?:scripts\/check(?:-lock)?\.ts|scripts\/check\/|mise\.toml)/;
    const unclassified = tracked.filter((path) => !gate.test(path) && planChecks([path]).reason.startsWith('Unclassified'));
    expect(unclassified).toEqual([]);
  });
});

describe('checkSteps', () => {
  it('runs the app gate in its documented order', () => {
    expect(names({ suites: ['app'], reason: '' })).toEqual([
      'App lint',
      'App typecheck',
      'Convex typecheck',
      'App tests and coverage',
      'Coverage gaps',
    ]);
  });

  it("runs the website's and CLI's Cargo gates in their own folders, as CI does", () => {
    const steps = checkSteps({ suites: ['web', 'cli'], reason: '' });
    expect(steps.map((step) => [step.name, step.cwd])).toEqual([
      ['Website format', 'web'],
      ['Website clippy', 'web'],
      ['Website tests', 'web'],
      ['CLI format', 'cli'],
      ['CLI clippy', 'cli'],
      ['CLI tests', 'cli'],
    ]);
    // Through mise in the folder, so its pinned Rust and mbx apply.
    expect(steps[1].command).toEqual(['mise', 'exec', '--', 'cargo', 'clippy', '--all-targets', '--locked', '--', '-D', 'warnings']);
  });
});
