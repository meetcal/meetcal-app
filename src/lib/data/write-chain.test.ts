import { createKeyedWriteChain, createWriteChain } from "@/lib/data/write-chain";

describe("createWriteChain", () => {
  it("runs each task only after the previous one settled", async () => {
    const chain = createWriteChain();
    let value = 0;
    const order: string[] = [];
    // Each task reads, yields, then writes: overlapping, the second would
    // read the first one's starting value and its write would win.
    const increment = (label: string) =>
      chain(async () => {
        const read = value;
        order.push(`${label}:start`);
        await new Promise((resolve) => setTimeout(resolve, 0));
        value = read + 1;
        order.push(`${label}:end`);
        return value;
      });

    const results = await Promise.all([increment("a"), increment("b"), increment("c")]);

    expect(value).toBe(3);
    expect(results).toEqual([1, 2, 3]);
    expect(order).toEqual(["a:start", "a:end", "b:start", "b:end", "c:start", "c:end"]);
  });

  it("rejects only the failed task's caller and keeps the chain going", async () => {
    const chain = createWriteChain();
    const failed = chain(async () => {
      throw new Error("disk full");
    });
    const next = chain(async () => "written");

    await expect(failed).rejects.toThrow("disk full");
    await expect(next).resolves.toBe("written");
  });

  it("keeps separate chains independent", async () => {
    const first = createWriteChain();
    const second = createWriteChain();
    let release!: () => void;
    const blocked = first(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );

    await expect(second(async () => "not blocked")).resolves.toBe("not blocked");
    release();
    await blocked;
  });
});

describe("createKeyedWriteChain", () => {
  it("runs one key's tasks in order while other keys go ahead", async () => {
    const chain = createKeyedWriteChain();
    const order: string[] = [];
    let release!: () => void;
    const clear = chain("Meet A", async () => {
      order.push("clear:start");
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      order.push("clear:end");
    });
    const save = chain("Meet A", async () => {
      order.push("save");
    });

    await chain("Meet B", async () => {
      order.push("other meet");
    });
    expect(order).toEqual(["clear:start", "other meet"]);

    release();
    await Promise.all([clear, save]);
    expect(order).toEqual(["clear:start", "other meet", "clear:end", "save"]);
  });

  it("rejects only the failed task's caller and keeps the key's chain going", async () => {
    const chain = createKeyedWriteChain();
    const failed = chain("Meet A", async () => {
      throw new Error("disk full");
    });
    const next = chain("Meet A", async () => "written");

    await expect(failed).rejects.toThrow("disk full");
    await expect(next).resolves.toBe("written");
  });
});
