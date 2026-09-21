import * as Sharing from "expo-sharing";
import { captureRef } from "react-native-view-shot";

import { captureViewAsPng, shareImageFile } from "@/lib/share-image";

jest.mock("expo-sharing", () => ({
  isAvailableAsync: jest.fn(),
  shareAsync: jest.fn(),
}));

jest.mock("react-native-view-shot", () => ({
  captureRef: jest.fn(),
}));

const mockCaptureRef = captureRef as jest.MockedFunction<typeof captureRef>;
const mockIsAvailableAsync = Sharing.isAvailableAsync as jest.MockedFunction<
  typeof Sharing.isAvailableAsync
>;
const mockShareAsync = Sharing.shareAsync as jest.MockedFunction<
  typeof Sharing.shareAsync
>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe("captureViewAsPng", () => {
  it("captures a full-quality png to a temp file", async () => {
    mockCaptureRef.mockResolvedValue("file:///tmp/a.png");

    const uri = await captureViewAsPng(null);

    expect(uri).toBe("file:///tmp/a.png");
    expect(mockCaptureRef).toHaveBeenCalledWith(null, {
      format: "png",
      quality: 1,
      result: "tmpfile",
      width: undefined,
      height: undefined,
    });
  });

  it("passes a fixed render width through when one is given", async () => {
    mockCaptureRef.mockResolvedValue("file:///tmp/b.png");

    await captureViewAsPng(null, { width: 850 });

    expect(mockCaptureRef).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ width: 850, height: undefined }),
    );
  });
});

describe("shareImageFile", () => {
  it("hands the png to the platform share sheet", async () => {
    mockIsAvailableAsync.mockResolvedValue(true);

    await shareImageFile("file:///tmp/a.png", "Share Recap");

    expect(mockShareAsync).toHaveBeenCalledWith("file:///tmp/a.png", {
      mimeType: "image/png",
      dialogTitle: "Share Recap",
    });
  });

  it("throws instead of silently succeeding when there is no share sheet", async () => {
    mockIsAvailableAsync.mockResolvedValue(false);

    await expect(shareImageFile("file:///tmp/a.png", "Share Recap")).rejects.toThrow(
      "Sharing is not available on this device",
    );
    expect(mockShareAsync).not.toHaveBeenCalled();
  });
});
