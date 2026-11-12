import { assertArray, assertHasFields, assertObject } from '@/lib/api/api-validators';
import { requireToken, userCall } from '@/lib/api/meetcal-api';

export type ApiSavedSession = {
  session_id: string;
  meet: string;
  session_number: number;
  platform: string;
  weight_class?: string | null;
  start_time?: string | null;
  date?: string | null;
  notes?: string | null;
  athlete_names: string[];
  updated_at: number;
};

function mapApiSavedSession(row: unknown, index: number): ApiSavedSession {
  const obj = assertHasFields(row, `/users/me/saved-sessions[${index}]`, [
    'session_id',
    'meet',
    'session_number',
    'platform',
    'athlete_names',
    'updated_at',
  ]);
  if (typeof obj.session_id !== 'string' || obj.session_id.length === 0) {
    throw new Error(`/users/me/saved-sessions[${index}] has invalid session_id`);
  }
  if (typeof obj.meet !== 'string' || obj.meet.length === 0) {
    throw new Error(`/users/me/saved-sessions[${index}] has invalid meet`);
  }
  if (typeof obj.session_number !== 'number' || !Number.isFinite(obj.session_number)) {
    throw new Error(`/users/me/saved-sessions[${index}] has invalid session_number`);
  }
  if (typeof obj.platform !== 'string') {
    throw new Error(`/users/me/saved-sessions[${index}] has invalid platform`);
  }
  if (!Array.isArray(obj.athlete_names) || !obj.athlete_names.every((name) => typeof name === 'string')) {
    throw new Error(`/users/me/saved-sessions[${index}] has invalid athlete_names`);
  }
  if (typeof obj.updated_at !== 'number' || !Number.isFinite(obj.updated_at)) {
    throw new Error(`/users/me/saved-sessions[${index}] has invalid updated_at`);
  }
  return {
    session_id: obj.session_id,
    meet: obj.meet,
    session_number: obj.session_number,
    platform: obj.platform,
    weight_class: typeof obj.weight_class === 'string' ? obj.weight_class : null,
    start_time: typeof obj.start_time === 'string' ? obj.start_time : null,
    date: typeof obj.date === 'string' ? obj.date : null,
    notes: typeof obj.notes === 'string' ? obj.notes : null,
    athlete_names: obj.athlete_names,
    updated_at: obj.updated_at,
  };
}

export async function fetchSavedSessions(token: string): Promise<ApiSavedSession[]> {
  const authToken = requireToken(token, 'fetchSavedSessions');
  const response = await userCall('/users/me/saved-sessions', 'users:savedSessions', 'query', authToken);
  assertObject(response, '/users/me/saved-sessions');
  const sessions = assertArray(
    (response as { sessions?: unknown }).sessions,
    '/users/me/saved-sessions.sessions',
  );
  return sessions.map(mapApiSavedSession);
}

export interface SavedSessionWriteRevision {
  device: string;
  rev: number;
}

export const MAX_SAVED_SESSION_DEVICE_LEN = 64;

function writeRevisionArgs(
  revision: SavedSessionWriteRevision | undefined,
  label: string,
): Partial<SavedSessionWriteRevision> {
  if (revision === undefined) return {};
  const { device, rev } = revision;
  if (typeof device !== 'string' || device.trim() === '' || Array.from(device).length > MAX_SAVED_SESSION_DEVICE_LEN) {
    throw new Error(`${label} requires a device id of 1 to ${MAX_SAVED_SESSION_DEVICE_LEN} characters`);
  }
  if (typeof rev !== 'number' || !Number.isSafeInteger(rev) || rev < 1) {
    throw new Error(`${label} requires a rev that is a whole number from 1`);
  }
  return { device, rev };
}

export async function putSavedSession(
  token: string,
  sessionId: string,
  body: {
    meet: string;
    session_number: number;
    platform: string;
    weight_class?: string;
    start_time?: string;
    date?: string;
    notes?: string;
    athlete_names?: string[];
  },
  revision?: SavedSessionWriteRevision,
): Promise<{ session_id: string; updated_at: number }> {
  const authToken = requireToken(token, 'putSavedSession');
  const order = writeRevisionArgs(revision, 'putSavedSession');
  const row = assertHasFields(
    await userCall(`/users/me/saved-sessions/${sessionId}`, 'users:putSavedSession', 'mutation', authToken, {
      sessionId,
      ...body,
      ...order,
    }),
    'putSavedSession',
    ['session_id', 'updated_at'],
  );
  if (typeof row.session_id !== 'string' || typeof row.updated_at !== 'number') {
    throw new Error('putSavedSession returned an invalid payload');
  }
  return { session_id: row.session_id, updated_at: row.updated_at };
}

export async function deleteSavedSession(
  token: string,
  sessionId: string,
  revision?: SavedSessionWriteRevision,
): Promise<{ deleted: boolean }> {
  const authToken = requireToken(token, 'deleteSavedSession');
  const order = writeRevisionArgs(revision, 'deleteSavedSession');
  const row = await userCall(
    `/users/me/saved-sessions/${sessionId}`,
    'users:deleteSavedSession',
    'mutation',
    authToken,
    { sessionId, ...order },
  );
  const ack = assertHasFields(row, 'deleteSavedSession', ['deleted']);
  if (typeof ack.deleted !== 'boolean') {
    throw new Error('deleteSavedSession returned an invalid payload');
  }
  return { deleted: ack.deleted };
}

export async function deleteSavedSessions(
  token: string,
  meet?: string,
  revision?: SavedSessionWriteRevision,
): Promise<{ deleted_count: number }> {
  const authToken = requireToken(token, 'deleteSavedSessions');
  const order = writeRevisionArgs(revision, 'deleteSavedSessions');
  const row = await userCall('/users/me/saved-sessions', 'users:deleteSavedSessions', 'mutation', authToken, {
    meet,
    ...order,
  });
  const ack = assertHasFields(row, 'deleteSavedSessions', ['deleted_count']);
  if (typeof ack.deleted_count !== 'number' || !Number.isFinite(ack.deleted_count)) {
    throw new Error('deleteSavedSessions returned an invalid payload');
  }
  return { deleted_count: ack.deleted_count };
}
