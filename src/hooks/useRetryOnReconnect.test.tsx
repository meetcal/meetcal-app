import React from "react";
import { act, create } from "react-test-renderer";

import { RECONNECT_REFETCH_JITTER_MAX_MS } from "@/lib/data/mutable-resource";
import { useRetryOnReconnect } from "@/hooks/useRetryOnReconnect";

let mockListener: ((isConnected: boolean) => void) | null = null;
const mockUnsubscribe = jest.fn();
jest.mock("@/lib/networkUtils", () => ({
  subscribeToNetworkChanges: (listener: (isConnected: boolean) => void) => {
    mockListener = listener;
    return () => {
      mockListener = null;
      mockUnsubscribe();
    };
  },
}));

function Harness({ active, retry }: { active: boolean; retry: () => void }) {
  useRetryOnReconnect(active, retry);
  return null;
}

const notify = (isConnected: boolean) => {
  act(() => {
    mockListener?.(isConnected);
  });
};
const passJitter = () => {
  act(() => {
    jest.advanceTimersByTime(RECONNECT_REFETCH_JITTER_MAX_MS);
  });
};

describe("useRetryOnReconnect", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockListener = null;
    mockUnsubscribe.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("retries once on an offline -> online edge, after the jitter", () => {
    const retry = jest.fn();
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<Harness active retry={retry} />);
    });

    notify(false);
    notify(true);
    // A flapping connection does not stack retries.
    notify(false);
    notify(true);
    expect(retry).not.toHaveBeenCalled();
    passJitter();
    expect(retry).toHaveBeenCalledTimes(1);

    act(() => tree.unmount());
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it("does nothing for an online report that was never preceded by offline", () => {
    const retry = jest.fn();
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<Harness active retry={retry} />);
    });

    notify(true);
    passJitter();
    expect(retry).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it("does not listen while inactive, and drops a pending retry when it stops", () => {
    const retry = jest.fn();
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<Harness active={false} retry={retry} />);
    });
    expect(mockListener).toBeNull();

    act(() => tree.update(<Harness active retry={retry} />));
    notify(false);
    notify(true);
    act(() => tree.update(<Harness active={false} retry={retry} />));
    passJitter();
    expect(retry).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });
});
