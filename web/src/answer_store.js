const DATABASE = "meetcal-answers";
const DATABASE_VERSION = 1;
const ANSWERS = "answers";
const PASSES = "passes";
const MAX_STORED_ANSWERS = 200;

let opening = null;

function request(operation) {
  return new Promise((resolve, reject) => {
    operation.onsuccess = () => resolve(operation.result);
    operation.onerror = () => reject(operation.error);
  });
}

function database() {
  if (!opening) {
    opening = new Promise((resolve, reject) => {
      const open = indexedDB.open(DATABASE, DATABASE_VERSION);
      open.onupgradeneeded = () => {
        open.result.createObjectStore(ANSWERS);
        open.result.createObjectStore(PASSES);
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
      open.onblocked = () => reject(new Error("answer store blocked"));
    });
    opening.catch(() => { opening = null; });
  }
  return opening;
}

async function store(name, mode) {
  const db = await database();
  return db.transaction(name, mode).objectStore(name);
}

async function quietly(work, fallback) {
  try {
    return await work();
  } catch {
    return fallback;
  }
}

export function stored_answer(key, now) {
  return quietly(async () => {
    const answer = await request((await store(ANSWERS, "readonly")).get(key));
    if (!answer) return null;
    if (answer.expiresAt !== null && answer.expiresAt <= now) {
      await request((await store(ANSWERS, "readwrite")).delete(key));
      return null;
    }
    return answer;
  }, null);
}

export function store_answer(key, etag, json, premium, expiresAt, now) {
  return quietly(async () => {
    const answers = await store(ANSWERS, "readwrite");
    await request(answers.put({ etag, json, premium, expiresAt, savedAt: now }, key));
    const count = await request(answers.count());
    if (count <= MAX_STORED_ANSWERS) return;
    const oldest = [];
    await new Promise((resolve, reject) => {
      const cursor = answers.openCursor();
      cursor.onsuccess = () => {
        const at = cursor.result;
        if (!at) return resolve();
        oldest.push([at.value.savedAt, at.key]);
        at.continue();
      };
      cursor.onerror = () => reject(cursor.error);
    });
    oldest.sort((left, right) => left[0] - right[0]);
    const fresh = await store(ANSWERS, "readwrite");
    for (const [, staleKey] of oldest.slice(0, count - MAX_STORED_ANSWERS)) fresh.delete(staleKey);
  }, undefined);
}

export function stored_pass(user, now) {
  return quietly(async () => {
    const held = await request((await store(PASSES, "readonly")).get(user));
    return held && held.until > now ? held : null;
  }, null);
}

export function store_pass(user, pass, until) {
  return quietly(async () => {
    const passes = await store(PASSES, "readwrite");
    await request(passes.clear());
    await request(passes.put({ pass, until }, user));
  }, undefined);
}

export function forget_premium_answers() {
  return quietly(async () => {
    await request((await store(PASSES, "readwrite")).clear());
    const answers = await store(ANSWERS, "readwrite");
    await new Promise((resolve, reject) => {
      const cursor = answers.openCursor();
      cursor.onsuccess = () => {
        const at = cursor.result;
        if (!at) return resolve();
        if (at.value.premium) at.delete();
        at.continue();
      };
      cursor.onerror = () => reject(cursor.error);
    });
  }, undefined);
}
