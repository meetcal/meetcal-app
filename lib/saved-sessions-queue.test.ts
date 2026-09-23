import { createSerialQueue } from "@/lib/saved-sessions-queue";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("createSerialQueue", () => {
  it("runs tasks one at a time in call order, even when the first is slowest", async () => {
    const queue = createSerialQueue();
    const log: string[] = [];

    const first = queue.run(async () => {
      log.push("start 1");
      await wait(20);
      log.push("end 1");
      return 1;
    });
    const second = queue.run(async () => {
      log.push("start 2");
      log.push("end 2");
      return 2;
    });

    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    expect(log).toEqual(["start 1", "end 1", "start 2", "end 2"]);
  });

  it("keeps going after a task rejects and surfaces the rejection to its caller", async () => {
    const queue = createSerialQueue();

    const failing = queue.run(async () => {
      throw new Error("boom");
    });
    const next = queue.run(async () => "ok");

    await expect(failing).rejects.toThrow("boom");
    await expect(next).resolves.toBe("ok");
  });
});
