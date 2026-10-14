import React from "react";
import { act, create } from "react-test-renderer";
import FilterModalOptions from "@/components/ui/filters/FilterModalOptions";
import FilterModalTitle from "@/components/ui/filters/FilterModalTitle";
import GenericFilterModal, {
  type FilterSection,
} from "@/components/ui/filters/GenericFilterModal";

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@/lib/haptics", () => ({ lightImpact: jest.fn() }));
jest.mock("@/components/ui/IconSymbol", () => ({ IconSymbol: () => null }));

/**
 * The Records shape: Age Group options depend on the federation, and the
 * first option in display order is not the applied one.
 */
const AGE_GROUPS: Record<string, string[]> = {
  USAW: ["U13", "U15", "Youth", "Junior", "Senior"],
  IWF: ["Youth", "Junior", "Senior"],
};

function sections(temp: Record<string, string>): FilterSection[] {
  return [
    {
      id: "federation",
      title: "Federation",
      options: Object.keys(AGE_GROUPS).map((f) => ({ value: f, label: f })),
    },
    {
      id: "gender",
      title: "Gender",
      options: [
        { value: "Men", label: "Men" },
        { value: "Women", label: "Women" },
      ],
    },
    {
      id: "ageGroup",
      title: "Age Group",
      options: (AGE_GROUPS[temp.federation] ?? []).map((a) => ({ value: a, label: a })),
      dependsOn: ["federation"],
    },
  ];
}

const APPLIED = { federation: "USAW", gender: "Men", ageGroup: "Senior" };

type Props = React.ComponentProps<typeof GenericFilterModal>;

function setup(overrides: Partial<Props> = {}) {
  const onApplyFilters = jest.fn();
  const onResetFilters = jest.fn();
  let props: Props = {
    visible: false,
    onClose: jest.fn(),
    sections,
    filters: APPLIED,
    onApplyFilters,
    onResetFilters,
    ...overrides,
  };
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(<GenericFilterModal {...props} />);
  });
  const rerender = (next: Partial<Props>) => {
    props = { ...props, ...next };
    act(() => {
      tree.update(<GenericFilterModal {...props} />);
    });
  };
  const title = (name: string) =>
    tree.root.findAll(
      (node) => node.type === FilterModalTitle && node.props.title === name,
    )[0];
  const valueOf = (name: string) => title(name)?.props.value;
  const choose = (name: string, value: string) => {
    act(() => {
      title(name).props.onPress();
    });
    act(() => {
      tree.root.findByType(FilterModalOptions).props.onSelect(value);
    });
  };
  const text = () => JSON.stringify(tree.toJSON());
  return { tree, rerender, valueOf, choose, text, onApplyFilters, onResetFilters };
}

describe("GenericFilterModal", () => {
  it("opens on the applied value of a section that depends on another", () => {
    const sheet = setup();
    sheet.rerender({ visible: true });

    // The dependency pass used to compare the seeded filters with the stale
    // `{}` of the first open and replace Age Group with "U13".
    expect(sheet.valueOf("Age Group")).toBe("Senior");
  });

  it("applies the opened dependent value when only another section changes", () => {
    const sheet = setup();
    sheet.rerender({ visible: true });
    sheet.choose("Gender", "Women");

    // `handleApply` hands the sheet's values to the screen.
    const applyButton = sheet.tree.root.findAll(
      (node) =>
        typeof node.props.onPress === "function" &&
        node.findAll((child) => child.children.includes("Apply")).length > 0,
    );
    act(() => {
      applyButton[applyButton.length - 1].props.onPress();
    });

    expect(sheet.onApplyFilters).toHaveBeenCalledWith({
      federation: "USAW",
      gender: "Women",
      ageGroup: "Senior",
    });
  });

  it("opens on the applied values when it is mounted already visible", () => {
    const sheet = setup({ visible: true });
    expect(sheet.valueOf("Age Group")).toBe("Senior");
  });

  it("still resets the dependent section when its dependency changes in the sheet", () => {
    const sheet = setup();
    sheet.rerender({ visible: true });

    sheet.choose("Federation", "IWF");
    expect(sheet.valueOf("Age Group")).toBe("Youth");
  });

  it("drops a dismissed edit, so the next open shows the applied values", () => {
    const sheet = setup();
    sheet.rerender({ visible: true });
    sheet.choose("Federation", "IWF");
    expect(sheet.valueOf("Age Group")).toBe("Youth");

    sheet.rerender({ visible: false });
    sheet.rerender({ visible: true });

    expect(sheet.valueOf("Federation")).toBe("USAW");
    expect(sheet.valueOf("Age Group")).toBe("Senior");
  });

  it("opens on the screen's reset values after a Reset", () => {
    const sheet = setup();
    sheet.rerender({ visible: true });
    sheet.choose("Federation", "IWF");

    const resetButton = sheet.tree.root.findAll(
      (node) =>
        typeof node.props.onPress === "function" &&
        node.findAll((child) => child.children.includes("Reset")).length > 0,
    );
    act(() => {
      resetButton[resetButton.length - 1].props.onPress();
    });
    expect(sheet.onResetFilters).toHaveBeenCalledTimes(1);

    sheet.rerender({ visible: false, filters: APPLIED });
    sheet.rerender({ visible: true });

    expect(sheet.valueOf("Federation")).toBe("USAW");
    expect(sheet.valueOf("Age Group")).toBe("Senior");
  });

  it("counts results for the edited values, and hides an unknown count", () => {
    const resultCount = (temp: Record<string, string>) =>
      temp.gender === "Men" ? 40 : temp.gender === "Women" ? 35 : undefined;
    const sheet = setup({ resultCount, resultLabel: "rankings" });
    sheet.rerender({ visible: true });
    expect(sheet.text()).toContain("40 rankings");

    sheet.choose("Gender", "Women");
    expect(sheet.text()).toContain("35 rankings");

    sheet.choose("Gender", "");
    expect(sheet.text()).not.toContain("rankings");
  });
});
