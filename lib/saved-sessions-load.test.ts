import {
  createLoadChain,
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
