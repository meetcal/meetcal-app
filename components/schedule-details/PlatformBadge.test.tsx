import React from "react";
import { Text, View } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { PlatformBadge } from "@/components/schedule-details/PlatformBadge";
import { PlatformPalette } from "@/constants/Palette";

async function render(platform: string) {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<PlatformBadge platform={platform} />);
  });
  const badge = renderer.root.findAll(
    (node) => node.type === View && node.props.testID === "platform-badge",
  )[0];
  const text = renderer.root.findAllByType(Text)[0];
  const backgroundColor = ([] as { backgroundColor?: string }[])
    .concat(badge.props.style)
    .flat()
    .map((style) => style?.backgroundColor)
    .filter(Boolean)
    .pop();
  return { backgroundColor, label: ([] as unknown[]).concat(text.props.children).join("") };
}

describe("PlatformBadge", () => {
  it("shows an unknown platform's name on the neutral color", async () => {
    expect(await render("Platform 3")).toEqual({
      backgroundColor: PlatformPalette.neutral,
      label: "Platform 3",
    });
  });

  it("shows Gold with its own color, not Red", async () => {
    expect(await render("Gold")).toEqual({ backgroundColor: PlatformPalette.gold, label: "Gold" });
  });

  it("keeps the historical Red color", async () => {
    expect(await render("Red")).toEqual({ backgroundColor: PlatformPalette.red, label: "Red" });
  });
});
