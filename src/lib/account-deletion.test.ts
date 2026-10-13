import AsyncStorage from "@react-native-async-storage/async-storage";
import { accountDeletionMessage, clearLocalUserData, subscriptionManagementUrl } from "@/lib/account-deletion";
import { clearAccountDeleted, markAccountDeleted } from "@/lib/deleted-accounts";
import { markSessionPut } from "@/lib/saved-sessions-outbox";
import { commitStoredSessions, createSavedSessionsCache, readStoredSessions } from "@/lib/saved-sessions-store";
import type { SavedSession } from "@/lib/saved-sessions-store";

describe("account deletion", () => {
  it.each([
    ["ios", "the App Store"],
    ["android", "Google Play"],
  ])("on %s, says what is lost and that the %s subscription is separate", (os, store) => {
    const message = accountDeletionMessage(os);
    expect(message).toMatch(/saved sessions, notes and reminder settings/);
    expect(message).toContain(`does not cancel your subscription. Cancel it in ${store}`);
    expect(message).toMatch(/Delete account/);
  });

  it("links to the platform's subscription management, not a sign-in page", () => {
    expect(subscriptionManagementUrl("ios")).toBe("https://apps.apple.com/account/subscriptions");
    expect(subscriptionManagementUrl("android")).toBe(
      "https://play.google.com/store/account/subscriptions",
    );
  });

  it("clears only the deleted user's saved sessions and outbox from the device", async () => {
    await AsyncStorage.multiSet([
      ["@saved_sessions_user_1", "[]"],
      ["@saved_sessions_outbox_user_1", "[]"],
      ["@saved_sessions_outbox_seeded_user_1", "1"],
      // Keys older builds stored saved sessions under.
      ["savedSessions_user_1", "[]"],
      ["@savedSessions_user_1", "[]"],
      ["sessions_user_1", "[]"],
      ["@saved_sessions_user_2", "[]"],
    ]);
    await clearLocalUserData("user_1");
    expect(await AsyncStorage.getAllKeys()).toEqual(["@saved_sessions_user_2"]);
  });

  it("keeps a write still in flight from storing the deleted account's data again, until the user signs in again", async () => {
    const session: SavedSession = {
      id: "s1",
      meet: "Test Meet" as never,
      sessionNumber: 1,
      platform: "Red",
      weightClass: "71kg",
      startTime: "10:00 AM",
      weighInTime: "8:00 AM",
      date: "2099-06-20",
      notes: "private",
    };
    const store = { cache: createSavedSessionsCache(), isActive: () => true, publish: () => {} };
    await AsyncStorage.clear();
    await clearLocalUserData("user_9");
    // A save and an outbox update that were already past their signed-in check.
    await commitStoredSessions(store as never, "user_9", [session]);
    await markSessionPut("user_9", session);
    expect(await AsyncStorage.getAllKeys()).toEqual([]);

    // Only signed out: signing in as the same user stores again.
    clearAccountDeleted("user_9");
    await commitStoredSessions(store as never, "user_9", [session]);
    expect(await AsyncStorage.getItem("@saved_sessions_user_9")).toContain("private");
  });

  it("keeps a deleted account's sessions out of the memory cache too", async () => {
    const session: SavedSession = { id: "s1", meet: "Test Meet" as never, sessionNumber: 1, platform: "Red", weightClass: "71kg", startTime: "10:00 AM", weighInTime: "8:00 AM", date: "2099-06-20", notes: "private" };
    const published: SavedSession[][] = [];
    const store = { cache: createSavedSessionsCache(), isActive: () => true, publish: (list: SavedSession[]) => published.push(list) };
    await AsyncStorage.clear();
    clearAccountDeleted("user_8");
    await commitStoredSessions(store as never, "user_8", [session]);
    expect(await readStoredSessions(store as never, "user_8")).toHaveLength(1);

    // Deleted while a write is in flight: the write is undone, and nothing is cached or published.
    const setItem = AsyncStorage.setItem;
    jest.spyOn(AsyncStorage, "setItem").mockImplementationOnce(async (key, value) => {
      markAccountDeleted("user_8");
      await setItem(key, value);
    });
    await commitStoredSessions(store as never, "user_8", [session, { ...session, id: "s2" }]);
    expect(published).toHaveLength(1);
    expect(await AsyncStorage.getItem("@saved_sessions_user_8")).toBeNull();
    // And the cached list from before is not served.
    expect(await readStoredSessions(store as never, "user_8")).toEqual([]);
    expect(store.cache.owner).toBeNull();
    clearAccountDeleted("user_8");
  });
});

