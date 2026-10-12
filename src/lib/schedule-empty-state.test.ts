import { noMeetState } from "@/lib/schedule-empty-state";

describe("noMeetState", () => {
  it("offers the meet picker whenever there are meets to pick", () => {
    for (const isOffline of [true, false]) {
      expect(noMeetState({ isOffline, hasMeets: true })).toMatchObject({
        action: "choose-meet",
        actionLabel: "Choose a Meet",
      });
    }
  });

  it("tells offline apart from no meets, and offers a retry for both", () => {
    const offline = noMeetState({ isOffline: true, hasMeets: false });
    const empty = noMeetState({ isOffline: false, hasMeets: false });
    expect(offline).toMatchObject({ title: "You're offline", action: "refresh" });
    expect(empty).toMatchObject({ title: "No meets available", action: "refresh" });
    expect(offline.message).not.toBe(empty.message);
  });
});
