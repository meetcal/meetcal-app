import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import FilterModalOptions from "@/components/ui/filters/FilterModalOptions";

// Touch react-native's lazy getters at module load (see ClubFilterModal.test.tsx).
void [Pressable, ScrollView, StyleSheet, Text, View];

function render(options: React.ComponentProps<typeof FilterModalOptions>["options"]) {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FilterModalOptions
        options={options}
        selectedValue=""
        onSelect={jest.fn()}
        maxHeight={300}
      />,
    );
  });
  return tree;
}

function texts(tree: ReactTestRenderer): string[] {
  return tree.root
    .findAllByType(Text)
    .map((node) => [node.props.children].flat().join(""))
    .filter((text) => text.length > 0);
}

describe("FilterModalOptions", () => {
  it("heads each run of options that share a group, once", () => {
    const tree = render([
      { value: "a", label: "Open Men's 85kg", group: "Current classes" },
      { value: "b", label: "Open Men's 95kg", group: "Current classes" },
      { value: "c", label: "Open Men's 88kg", group: "2025 classes" },
    ]);
    expect(texts(tree)).toEqual([
      "Current classes",
      "Open Men's 85kg",
      "Open Men's 95kg",
      "2025 classes",
      "Open Men's 88kg",
    ]);
    expect(tree.root.findAll((node) => node.props.accessibilityRole === "header" && node.type === View)).toHaveLength(2);
  });

  it("adds no heading to options without a group", () => {
    const tree = render([
      { value: "a", label: "Men" },
      { value: "b", label: "Women" },
    ]);
    expect(texts(tree)).toEqual(["Men", "Women"]);
  });
});
