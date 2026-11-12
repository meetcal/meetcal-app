import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { Text } from "react-native";
import { AnimatedCounter } from "@/components/wrapped/AnimatedCounter";

let nextFrame = 1;
let queued = new Map<number, FrameRequestCallback>();

beforeEach(() => {
  nextFrame = 1;
  queued = new Map();
  jest.spyOn(global, "requestAnimationFrame").mockImplementation((callback) => {
    const id = nextFrame++;
    queued.set(id, callback);
    return id;
  });
  jest.spyOn(global, "cancelAnimationFrame").mockImplementation((id) => {
    if (typeof id === "number") queued.delete(id);
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function shownText(tree: ReactTestRenderer): string {
  const children: unknown = tree.root.findByType(Text).props.children;
  return Array.isArray(children) ? children.join("") : String(children);
}

function runQueuedFrames() {
  const frames = [...queued.values()];
  queued.clear();
  act(() => {
    for (const frame of frames) frame(0);
  });
}

describe("AnimatedCounter", () => {
  it("counts up to the value with its suffix", () => {
    const now = jest.spyOn(Date, "now").mockReturnValue(0);
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<AnimatedCounter
        value={1500} delay={0} duration={100}
        suffix="kg"
      />);
    });
    now.mockReturnValue(100);
    runQueuedFrames();
    expect(shownText(tree)).toBe("1,500kg");
    expect(queued.size).toBe(0);
  });

  it("stops its frame loop when it unmounts", () => {
    jest.spyOn(Date, "now").mockReturnValue(0);
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<AnimatedCounter value={1500} delay={1000} />);
    });
    expect(queued.size).toBe(1);
    act(() => {
      tree.unmount();
    });
    expect(queued.size).toBe(0);
  });

  it("stops the old loop when the value changes", () => {
    jest.spyOn(Date, "now").mockReturnValue(0);
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<AnimatedCounter value={1500} delay={1000} />);
    });
    act(() => {
      tree.update(<AnimatedCounter value={2000} delay={1000} />);
    });
    expect(queued.size).toBe(1);
  });
});
