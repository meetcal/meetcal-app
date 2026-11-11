import { isSchedule, scheduleShapeProblem } from './schedule-shape';

const session = { id: '1', number: 1, startTime: '9:00 AM', weighInTime: '', platforms: [{ platform: 'Red', weightClass: '71kg' }] };
const day = { date: 'June 20, 2026', fullDate: '2026-06-20', sessions: [session] };

describe('scheduleShapeProblem', () => {
  it('accepts a schedule, an empty one included', () => {
    expect(scheduleShapeProblem([day])).toBeNull();
    expect(scheduleShapeProblem([])).toBeNull();
    expect(isSchedule([day])).toBe(true);
  });

  it('accepts a session with blank times', () => {
    expect(scheduleShapeProblem([{ ...day, sessions: [{ ...session, startTime: '', weighInTime: '' }] }])).toBeNull();
  });

  it('names what is wrong with a value that is not a schedule', () => {
    expect(scheduleShapeProblem({ sessions: [] })).toBe('Invalid schedule format');
    expect(scheduleShapeProblem([{ date: 'June 20, 2026', fullDate: '2026-06-20' }])).toBe('Invalid day structure at index 0');
    expect(scheduleShapeProblem([day, 'TBD'])).toBe('Invalid day structure at index 1');
    expect(scheduleShapeProblem([{ ...day, sessions: [session, { ...session, id: '' }] }])).toBe(
      'Invalid session structure at day 0, session 1',
    );
    expect(scheduleShapeProblem([{ ...day, sessions: [{ ...session, platforms: 'Red' }] }])).toBe(
      'Invalid session structure at day 0, session 0',
    );
    expect(scheduleShapeProblem([{ ...day, sessions: [{ ...session, platforms: [null] }] }])).toBe(
      'Invalid session structure at day 0, session 0',
    );
    expect(isSchedule([{ ...day, sessions: [{ ...session, number: '1' }] }])).toBe(false);
  });
});
