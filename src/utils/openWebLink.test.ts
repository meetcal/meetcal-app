import { Linking } from "react-native";

import { showToast } from "@/lib/toast";
import { openWebLink, WEB_LINK_FAILED_MESSAGE } from "./openWebLink";

jest.mock("@/lib/toast", () => ({ showToast: jest.fn() }));

describe("openWebLink", () => {
  let openURL: jest.SpyInstance;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    jest.mocked(showToast).mockReset();
    openURL = jest.spyOn(Linking, "openURL");
    warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    openURL.mockRestore();
    warn.mockRestore();
  });

  it("opens the link and says nothing when it opens", async () => {
    openURL.mockResolvedValue(true);

    await openWebLink("https://meetcal.app/privacy");

    expect(openURL).toHaveBeenCalledWith("https://meetcal.app/privacy");
    expect(showToast).not.toHaveBeenCalled();
  });

  it("tells the user when the link cannot be opened, without rejecting", async () => {
    openURL.mockRejectedValue(new Error("no app can open this URL"));

    await expect(openWebLink("https://meetcal.app/terms")).resolves.toBeUndefined();

    expect(showToast).toHaveBeenCalledWith({ type: "error", message: WEB_LINK_FAILED_MESSAGE });
  });
});
