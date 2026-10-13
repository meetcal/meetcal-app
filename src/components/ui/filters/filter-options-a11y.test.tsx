/**
 * Filter and sort options say which one is selected to VoiceOver/TalkBack,
 * not only with blue text and a checkmark.
 */
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import FilterModalOptions from "@/components/ui/filters/FilterModalOptions";
import FilterChipGroup from "@/components/ui/filters/FilterChipGroup";

jest.mock("@/components/ui/IconSymbol", () => ({ IconSymbol: () => null }));

const OPTIONS = [
  { value: "Senior", label: "Senior" },
  { value: "Junior", label: "Junior" },
];

function optionStates(renderer: ReactTestRenderer) {
  return renderer.root
    .findAll(
      (node) => node.props?.accessibilityRole === "button" && typeof node.props.onPress === "function",
    )
    .map((node) => node.props.accessibilityState?.selected);
}

describe("filter options", () => {
  it("sheet rows expose the selected option, the All row included", () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <FilterModalOptions
          options={OPTIONS}
          selectedValue="Junior"
          onSelect={jest.fn()}
          maxHeight={400}
          allOptionLabel="All"
        />,
      );
    });
    expect(optionStates(renderer)).toEqual([false, false, true]);
  });

  it("chips expose the selected option", () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <FilterChipGroup
          title="Age Group"
          options={OPTIONS}
          selectedValue=""
          onSelect={jest.fn()}
          allOptionLabel="All"
        />,
      );
    });
    expect(optionStates(renderer)).toEqual([true, false, false]);
  });
});
