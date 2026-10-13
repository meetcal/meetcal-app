import AsyncStorage from "@react-native-async-storage/async-storage";
import React from "react";
import { act, create } from "react-test-renderer";
import { clearAccountDeleted } from "@/lib/deleted-accounts";
import { useAccountSheetCleanup } from "@/hooks/useAccountSheetCleanup";

/** The hook's value, from a component rendering it. */
async function mount() {
  const current: { value: ReturnType<typeof useAccountSheetCleanup> | null } = { value: null };
  function Probe() {
    current.value = useAccountSheetCleanup();
    return null;
  }
  await act(async () => {
    create(<Probe />);
  });
  return current.value!;
}

describe("useAccountSheetCleanup (#250)", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    clearAccountDeleted("user_1");
  });

  it("clears the user's device data after a sign-out in the sheet, however it was opened", async () => {
    await AsyncStorage.multiSet([
      ["@saved_sessions_user_1", "[]"],
      ["@saved_sessions_outbox_user_1", "{}"],
      ["@saved_sessions_user_2", "[]"],
    ]);
    const sheet = await mount();
    // Opened from Edit Profile, whose screen also offers "Delete account".
    sheet.opened("user_1");
    await sheet.signedOut();
    expect(await AsyncStorage.getAllKeys()).toEqual(["@saved_sessions_user_2"]);
  });

  it("does nothing when the sheet was not opened for a user, and only once per opening", async () => {
    await AsyncStorage.setItem("@saved_sessions_user_1", "[]");
    const sheet = await mount();
    await sheet.signedOut();
    sheet.opened(undefined);
    await sheet.signedOut();
    expect(await AsyncStorage.getItem("@saved_sessions_user_1")).toBe("[]");
  });
});
