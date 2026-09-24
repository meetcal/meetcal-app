import { platformColor } from "@/constants/Colors";
import { PlatformPalette } from "@/constants/Palette";

describe("platformColor", () => {
  it.each([
    ["Red", PlatformPalette.red],
    ["White", PlatformPalette.white],
    ["Blue", PlatformPalette.blue],
    ["Stars", PlatformPalette.stars],
    ["Stripes", PlatformPalette.stripes],
    ["Rogue", PlatformPalette.rogue],
    ["Green", PlatformPalette.green],
    ["Yellow", PlatformPalette.yellow],
    ["Gold", PlatformPalette.gold],
    ["Silver", PlatformPalette.silver],
    ["Bronze", PlatformPalette.bronze],
    ["Orange", PlatformPalette.orange],
    ["Purple", PlatformPalette.purple],
    ["Pink", PlatformPalette.pink],
    ["Black", PlatformPalette.black],
    ["Gray", PlatformPalette.gray],
    ["Grey", PlatformPalette.gray],
    ["Brown", PlatformPalette.brown],
    ["Teal", PlatformPalette.teal],
    ["Navy", PlatformPalette.navy],
    ["Maroon", PlatformPalette.maroon],
  ])("gives %s its own color", (name, expected) => {
    expect(platformColor(name)).toBe(expected);
  });

  it("keeps White on the legible gray, not literal white", () => {
    expect(platformColor("White")).toBe("#8E8E93");
  });

  it("matches case-insensitively and ignoring padding", () => {
    expect(platformColor("RED ")).toBe(PlatformPalette.red);
    expect(platformColor(" gold")).toBe(PlatformPalette.gold);
  });

  it("matches compound names on their first word", () => {
    expect(platformColor("Red 2")).toBe(PlatformPalette.red);
    expect(platformColor("Blue B")).toBe(PlatformPalette.blue);
    expect(platformColor("Gold  Coast")).toBe(PlatformPalette.gold);
  });

  it("falls back to the one neutral color for everything else", () => {
    expect(platformColor("Platform 3")).toBe(PlatformPalette.neutral);
    expect(platformColor("Unknown")).toBe(PlatformPalette.neutral);
    expect(platformColor("")).toBe(PlatformPalette.neutral);
    expect(platformColor(undefined)).toBe(PlatformPalette.neutral);
  });

  it("does not paint Gold as Red", () => {
    expect(platformColor("Gold")).not.toBe(platformColor("Red"));
  });
});
