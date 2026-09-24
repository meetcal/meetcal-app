import React from "react";
import { Modal, Text } from "react-native";
import { act, create } from "react-test-renderer";
import FilterSheet from "@/components/ui/filters/FilterSheet.ios";

describe("FilterSheet (iOS)", () => {
  it("presents a native page sheet so swipe-down dismisses it", () => {
    const onClose = jest.fn();
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <FilterSheet visible onClose={onClose} header={<Text>Club</Text>}>
          <Text>Body</Text>
        </FilterSheet>,
      );
    });

    const modal = tree.root.findByType(Modal);
    expect(modal.props.presentationStyle).toBe("pageSheet");
    // A transparent modal cannot be a page sheet; UIKit would fall back to a
    // full-screen overlay with no swipe gesture.
    expect(modal.props.transparent).toBeFalsy();

    // UIKit reports the swipe dismissal through `onRequestClose`.
    act(() => modal.props.onRequestClose());
    expect(onClose).toHaveBeenCalledTimes(1);

    const json = JSON.stringify(tree.toJSON());
    expect(json).toContain("Club");
    expect(json).toContain("Body");
  });
});
