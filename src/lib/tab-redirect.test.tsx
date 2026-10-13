import React from "react";
import { act, create } from "react-test-renderer";

import OpenSavedScreen from "@/app/open/saved";
import NotFoundScreen from "@/app/+not-found";

const mockDismissTo = jest.fn();
jest.mock("expo-router", () => {
  const { useEffect } = jest.requireActual("react");
  return {
    useRouter: () => ({ dismissTo: mockDismissTo, replace: jest.fn() }),
    useFocusEffect: (effect: () => void) => useEffect(() => effect(), [effect]),
  };
});
jest.mock("@/lib/logger", () => ({ devLog: jest.fn() }));

describe("routes that forward into a tab (#357 follow-up)", () => {
  beforeEach(() => mockDismissTo.mockClear());

  it("sends /open/saved back to the existing tabs, on the Saved tab", () => {
    act(() => {
      create(<OpenSavedScreen />);
    });
    expect(mockDismissTo).toHaveBeenCalledWith("/(tabs)/(saved)");
  });

  it("sends an unknown route back to the Schedule tab", () => {
    act(() => {
      create(<NotFoundScreen />);
    });
    expect(mockDismissTo).toHaveBeenCalledWith("/(tabs)/(index)");
  });
});
