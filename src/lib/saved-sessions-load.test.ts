import {
  createLoadChain,
  createRefreshThrottle,
  savedSessionsLoadKey,
  sessionsFromApi,
} from "@/lib/saved-sessions-load";

describe("sessionsFromApi", () => {
  it("maps API rows and defaults nullable fields", () => {
    expect(
      sessionsFromApi([
        {
          session_id: "Meet-1-Red",
          meet: "Meet",
          session_number: 1,
          platform: "Red",
          weight_class: null,
          start_time: null,
          date: null,
          notes: null,
          athlete_names: ["A"],
        } as never,
      ]),
    ).toEqual([
      {
        id: "Meet-1-Red",
        meet: "Meet",
        sessionNumber: 1,
        platform: "Red",
        weightClass: "",
        startTime: "",
        weighInTime: "",
        date: "",
        notes: undefined,
        athleteNames: ["A"],
      },
    ]);
  });
});

describe("sessionsFromApi duplicates (#319)", () => {
  const row = (notes: string, updatedAt: number) =>
    ({
      session_id: "Meet-1-Red",
      meet: "Meet",
      session_number: 1,
      platform: "Red",
      weight_class: null,
      start_time: null,
      date: null,
      notes,
      athlete_names: [],
      updated_at: updatedAt,
    }) as never;

  it("keeps the newest row of a session an older backend lists twice, oldest first", () => {
    const sessions = sessionsFromApi([row("old", 1), row("new", 2)]);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].notes).toBe("new");
  });
});

describe("savedSessionsLoadKey", () => {
  it("distinguishes the user and whether Clerk verified them", () => {
    expect(savedSessionsLoadKey("u", true)).toBe("u:verified");
    expect(savedSessionsLoadKey("u", false)).toBe("u:cached");
    expect(savedSessionsLoadKey(null, false)).toBe(":cached");
  });
});

describe("createLoadChain", () => {
  function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }

  it("shares a running task with callers for the same key", async () => {
    const chain = createLoadChain();
    const gate = deferred();
    const task = jest.fn(() => gate.promise);
    const first = chain.run("a", task);
    const second = chain.run("a", task);
    expect(second).toBe(first);
    gate.resolve();
    await first;
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("runs a fresh task for the same key after the running one, not sharing it", async () => {
    const chain = createLoadChain();
    const gate = deferred();
    const log: string[] = [];
    const first = chain.run("a", async () => {
      await gate.promise;
      log.push("first");
    });
    const fresh = chain.run("a", async () => {
      log.push("fresh");
    }, { fresh: true });
    expect(fresh).not.toBe(first);
    gate.resolve();
    await fresh;
    expect(log).toEqual(["first", "fresh"]);
  });

  it("queues a new key behind the running task, even one that fails", async () => {
    const chain = createLoadChain();
    const gate = deferred();
    const log: string[] = [];
    const first = chain.run("a", async () => {
      await gate.promise;
      log.push("a");
      throw new Error("a failed");
    });
    const second = chain.run("b", async () => {
      log.push("b");
    });
    gate.resolve();
    await expect(first).rejects.toThrow("a failed");
    await second;
    expect(log).toEqual(["a", "b"]);
  });

  it("starts a fresh task for a key once the previous run settled", async () => {
    const chain = createLoadChain();
    const task = jest.fn(async () => undefined);
    await chain.run("a", task);
    await chain.run("a", task);
    expect(task).toHaveBeenCalledTimes(2);
  });
});

describe("createRefreshThrottle", () => {
  it("allows a refresh before any load and once the interval has passed since the last", () => {
    let now = 1_000_000;
    const throttle = createRefreshThrottle(60_000, () => now);
    expect(throttle.shouldRun()).toBe(true);
    throttle.markRun();
    now += 59_999;
    expect(throttle.shouldRun()).toBe(false);
    now += 1;
    expect(throttle.shouldRun()).toBe(true);
  });

  it("treats a clock set back since the last load as old", () => {
    let now = 1_000_000;
    const throttle = createRefreshThrottle(60_000, () => now);
    throttle.markRun();
    now -= 1;
    expect(throttle.shouldRun()).toBe(true);
  });
});
