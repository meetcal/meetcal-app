import React from "react";
import { act, create } from "react-test-renderer";

import EventInfoScreen from "@/components/info/EventInfoScreen";

let mockMeet: unknown = null;
jest.mock("@/contexts/SelectedMeetContext", () => ({
  useSelectedMeet: () => ({ meetDetails: mockMeet, isLoading: false }),
}));
jest.mock("@/contexts/ThemeContext", () => ({ useTheme: () => ({ currentTheme: "light" }) }));
jest.mock("@/components/ui/IconSymbol", () => ({ IconSymbol: () => null }));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn() }));

/** Rows drawn as tappable links (a chevron). */
const chevrons = (tree: ReturnType<typeof create>) =>
  tree.root.findAll((node) => node.props.name === "chevron.right" && typeof node.type !== "string");

const meet = (venue: unknown) => ({
  name: "Spring Open",
  venue,
  dates: { start: "2099-06-20", end: "2099-06-21" },
  time: { timeZone: "America/New_York", timeZoneIdentifier: "America/New_York", abbreviation: "EDT" },
});

function render() {
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(<EventInfoScreen />);
  });
  return tree;
}

describe("EventInfoScreen venue", () => {
  it("links a real address to Maps", () => {
    mockMeet = meet({
      name: "Convention Center",
      address: { street: "1 Main St", city: "Columbus", state: "OH", zip: "43215" },
    });
    const tree = render();
    expect(tree.root.findAllByProps({ testID: "info-venue-address" }).length).toBeGreaterThan(0);
    expect(chevrons(tree).length).toBeGreaterThan(0);
  });

  it("shows no tappable row for the backend's stand-in venue", () => {
    mockMeet = meet({
      name: "Spring Open",
      address: { street: "", city: "Unknown", state: "Unknown", zip: "Unknown" },
    });
    const tree = render();
    expect(tree.root.findAllByProps({ testID: "info-venue-address" })).toHaveLength(0);
    expect(chevrons(tree)).toHaveLength(0);
    // The stand-in name only repeats the title, so nothing is shown for it.
    expect(tree.root.findAllByProps({ testID: "info-venue-name" })).toHaveLength(0);
    // ...and no second divider stacked on the first.
    expect(tree.root.findAllByProps({ testID: "info-venue-divider" })).toHaveLength(0);
  });
});
