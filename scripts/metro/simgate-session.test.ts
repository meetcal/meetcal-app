import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { maestroArgsFor, sessionPort } from './simgate-session';

const repoRoot = join(__dirname, '..', '..');
const scripts = (JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as { scripts: Record<string, string> })
  .scripts;

describe('package.json', () => {
  it('runs every script that starts Metro, builds onto a simulator or runs Maestro through simgate', () => {
    for (const name of ['start', 'dev', 'ios', 'maestro:test', 'maestro:test:flow']) {
      expect(scripts[name]).toMatch(/^simgate run --platform ios --bundle-id com\.memohnsen\.meetcal /);
    }
    expect(scripts.ios).toContain('--record-build');
    expect(scripts.ios).toMatch(/ --device \{udid\}$/);
    expect(scripts.android).toMatch(/^simgate run --platform android /);
    expect(scripts.web).toMatch(/^simgate run --platform web /);
    const unwrapped = Object.entries(scripts).filter(
      ([, command]) => /\bexpo (?:start|run:)|\bmaestro test\b|maestro-session/.test(command) && !command.startsWith('simgate '),
    );
    expect(unwrapped).toEqual([]);
  });

  it('bootstraps the development client on the session simulator and port', () => {
    expect(scripts['maestro:bootstrap']).toContain('openurl ${SIMGATE_UDID:-booted}');
    expect(scripts['maestro:bootstrap']).toContain('%3A${SIMGATE_PORT:-8081}');
  });
});

describe('sessionPort', () => {
  it('reads the slot port simgate sets, or 8081 outside a session', () => {
    expect(sessionPort({})).toBe(8081);
    expect(sessionPort({ SIMGATE_PORT: '8082' })).toBe(8082);
    expect(() => sessionPort({ SIMGATE_PORT: '70000' })).toThrow('SIMGATE_PORT');
    expect(() => sessionPort({ SIMGATE_PORT: 'soon' })).toThrow('SIMGATE_PORT');
  });
});

describe('maestroArgsFor', () => {
  it('aims Maestro at the simulator simgate claimed, and at whatever is booted without one', () => {
    expect(maestroArgsFor('com.memohnsen.meetcal', ['.maestro'], 'U')).toEqual([
      '--device',
      'U',
      'test',
      '-e',
      'APP_ID=com.memohnsen.meetcal',
      '.maestro',
    ]);
    expect(maestroArgsFor('app', ['flow.yaml'], undefined)).toEqual(['test', '-e', 'APP_ID=app', 'flow.yaml']);
  });
});
